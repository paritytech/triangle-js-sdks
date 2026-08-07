import { enumValue } from '@novasamatech/scale';
import { createExpiryFromDuration } from '@novasamatech/sdk-statement';
import { deriveSlotAccountPublicKey, deriveSr25519PublicKey } from '@novasamatech/statement-store';
import { createMemoryAdapter } from '@novasamatech/storage-adapter';
import {
  ensureSubstrateSlotSr25519Ready,
  substrateSlotSecretFromSeedBytes,
} from '@novasamatech/substrate-slot-sr25519-wasm';
import { mnemonicToMiniSecret } from '@polkadot-labs/hdkd-helpers';
import { toHex } from 'polkadot-api/utils';
import { beforeAll, describe, expect, it } from 'vitest';

import { createAllowanceService } from '../src/sso/allowance/impl.js';
import { createAllowanceRepository } from '../src/sso/allowance/repository.js';
import type { ApAllocationOutcome } from '../src/sso/sessionManager/scale/resourceAllocation.js';
import type { UserSession } from '../src/sso/sessionManager/userSession.js';

import { createPairedUserSession } from './peerSession.js';

const DEV_MNEMONIC = 'bottom drive obey lake curtain smoke basket hold race lonely fit walk';
const SESSION_ID = 'session-1';

// A non-zero 64-byte blob used as a bulletin slot key in allocation/cache tests.
const FAKE_SECRET = new Uint8Array(64).fill(7);
const ANOTHER_SECRET = new Uint8Array(64).fill(11);

/**
 * The service under test, wired to a real UserSession whose peer is the paired
 * app answering over the in-memory statement store. `answer` is what that app
 * replies with — the outcomes it grants, or `'error'` to NACK the request.
 */
function buildService(answer?: ApAllocationOutcome[] | 'error') {
  const repository = createAllowanceRepository('salt', createMemoryAdapter());
  const { session, peer } = createPairedUserSession({ id: SESSION_ID });

  if (answer === 'error') {
    peer.ackWith('decodingFailed');
  } else if (answer) {
    peer.answerWith(request => {
      if (request.data.tag !== 'v1' || request.data.value.tag !== 'ResourceAllocationRequest') {
        throw new Error(`unexpected request ${request.data.tag}`);
      }

      return enumValue('ResourceAllocationResponse', {
        respondingTo: request.messageId,
        payload: { success: true as const, value: answer },
      });
    });
    peer.ackWith('success');
  }

  const sessions = { read: () => [session as UserSession], subscribe: () => () => undefined };

  return { service: createAllowanceService({ sessions, repository }), repository, peer };
}

// What the app actually received, decoded off the wire.
const allocationRequests = (peer: ReturnType<typeof buildService>['peer']) =>
  peer.received.flatMap(message =>
    message.data.tag === 'v1' && message.data.value.tag === 'ResourceAllocationRequest'
      ? [message.data.value.value]
      : [],
  );

const allocated = (resource: 'BulletInAllowance' | 'StatementStoreAllowance', slotAccountKey: Uint8Array) =>
  [enumValue('Allocated', enumValue(resource, { slotAccountKey }))] as ApAllocationOutcome[];

describe('createAllowanceService', () => {
  describe('getBulletinSigner', () => {
    it('requests from mobile on cache miss and persists the slot account key', async () => {
      const { service, repository, peer } = buildService(allocated('BulletInAllowance', FAKE_SECRET));

      const result = await service.getBulletinSigner(SESSION_ID, 'product.dot');

      await expect(result).toBeOk();
      expect(allocationRequests(peer)).toStrictEqual([
        {
          callingProductId: 'product.dot',
          resources: [{ tag: 'BulletInAllowance', value: undefined }],
          onExisting: 'Ignore',
        },
      ]);

      await expect(repository.read(SESSION_ID, 'product.dot', 'bulletin')).toBeOkWith(FAKE_SECRET);
    });

    it('uses cached key on cache hit without calling the session', async () => {
      const { service, repository, peer } = buildService();
      await repository.write(SESSION_ID, 'product.dot', 'bulletin', FAKE_SECRET);

      const result = await service.getBulletinSigner(SESSION_ID, 'product.dot');

      await expect(result).toBeOk();
      expect(peer.received).toStrictEqual([]);
    });

    it('returns Rejected error when mobile rejects', async () => {
      const { service } = buildService([enumValue('Rejected', undefined)]);

      const result = await service.getBulletinSigner(SESSION_ID, 'product.dot');

      await expect(result).toBeErrWith(expect.objectContaining({ reason: 'Rejected' }));
    });

    it('returns NotAvailable error when mobile reports unavailable', async () => {
      const { service } = buildService([enumValue('NotAvailable', undefined)]);

      const result = await service.getBulletinSigner(SESSION_ID, 'product.dot');

      await expect(result).toBeErrWith(expect.objectContaining({ reason: 'NotAvailable' }));
    });

    it('returns NoSession when sessionId does not match an active session', async () => {
      const { service } = buildService();

      const result = await service.getBulletinSigner('unknown-session', 'product.dot');

      await expect(result).toBeErrWith(expect.objectContaining({ reason: 'NoSession' }));
    });

    it('returns UnexpectedResponse when mobile returns the wrong resource tag', async () => {
      const { service } = buildService(allocated('StatementStoreAllowance', FAKE_SECRET));

      const result = await service.getBulletinSigner(SESSION_ID, 'product.dot');

      await expect(result).toBeErrWith(expect.objectContaining({ reason: 'UnexpectedResponse' }));
    });

    it('propagates a transport failure as UnexpectedResponse', async () => {
      const { service } = buildService('error');

      const result = await service.getBulletinSigner(SESSION_ID, 'product.dot');

      await expect(result).toBeErrWith(expect.objectContaining({ reason: 'UnexpectedResponse' }));
    });
  });

  describe('getStatementStoreProver', () => {
    beforeAll(async () => {
      await ensureSubstrateSlotSr25519Ready();
    });

    it('returns a prover that signs under the slot-derived public key', async () => {
      const slotSecret = substrateSlotSecretFromSeedBytes(mnemonicToMiniSecret(DEV_MNEMONIC));
      const { service } = buildService(allocated('StatementStoreAllowance', slotSecret));

      const proverResult = await service.getStatementStoreProver(SESSION_ID, 'product.dot');

      await expect(proverResult).toBeOk();

      const prover = proverResult._unsafeUnwrap();
      const signed = (
        await prover.generateMessageProof({
          expiry: createExpiryFromDuration(3600),
          data: new Uint8Array([1, 2, 3]),
          topics: [],
          channel: `0x${'00'.repeat(32)}`,
        })
      )._unsafeUnwrap();

      expect(signed.proof.type).toBe('sr25519');
      if (signed.proof.type !== 'sr25519') {
        throw new Error(`unexpected proof type ${signed.proof.type}`);
      }

      expect(signed.proof.value.signer).toBe(toHex(deriveSlotAccountPublicKey(slotSecret)));
      expect(signed.proof.value.signer).not.toBe(toHex(deriveSr25519PublicKey(slotSecret)));
    });

    it('requests StatementStoreAllowance and caches under the statementStore key', async () => {
      const { service, repository, peer } = buildService(allocated('StatementStoreAllowance', ANOTHER_SECRET));

      const result = await service.getStatementStoreProver(SESSION_ID, 'product.dot');

      await expect(result).toBeOk();
      expect(allocationRequests(peer)).toStrictEqual([
        {
          callingProductId: 'product.dot',
          resources: [{ tag: 'StatementStoreAllowance', value: undefined }],
          onExisting: 'Ignore',
        },
      ]);

      await expect(repository.read(SESSION_ID, 'product.dot', 'statementStore')).toBeOkWith(ANOTHER_SECRET);

      // bulletin slot must remain empty
      await expect(repository.read(SESSION_ID, 'product.dot', 'bulletin')).toBeOkWith(null);
    });
  });
});
