import { createExpiryFromDuration } from '@novasamatech/sdk-statement';
import { deriveSlotAccountPublicKey, deriveSr25519PublicKey } from '@novasamatech/statement-store';
import { createMemoryAdapter } from '@novasamatech/storage-adapter';
import {
  ensureSubstrateSlotSr25519Ready,
  substrateSlotSecretFromSeedBytes,
} from '@novasamatech/substrate-slot-sr25519-wasm';
import { mnemonicToMiniSecret } from '@polkadot-labs/hdkd-helpers';
import { errAsync, okAsync } from 'neverthrow';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAllowanceService } from '../src/sso/allowance/impl.js';
import { createAllowanceRepository } from '../src/sso/allowance/repository.js';
import type { UserSession } from '../src/sso/sessionManager/userSession.js';

const DEV_MNEMONIC = 'bottom drive obey lake curtain smoke basket hold race lonely fit walk';

const toHex = (bytes: Uint8Array) => `0x${[...bytes].map(b => b.toString(16).padStart(2, '0')).join('')}`;

// A non-zero 64-byte blob used as a bulletin slot key in allocation/cache tests.
const FAKE_SECRET = new Uint8Array(64).fill(7);
const ANOTHER_SECRET = new Uint8Array(64).fill(11);

function makeSession(overrides?: Partial<UserSession>): UserSession {
  const requestResourceAllocation = vi.fn();
  return {
    id: 'session-1',
    localAccount: {} as never,
    remoteAccount: {} as never,
    rootAccountId: new Uint8Array(32) as never,
    sendDisconnectMessage: vi.fn(),
    signPayload: vi.fn(),
    signRaw: vi.fn(),
    getRingVrfAlias: vi.fn(),
    requestResourceAllocation: requestResourceAllocation as never,
    subscribe: vi.fn(() => () => undefined),
    dispose: vi.fn(),
    ...overrides,
  } as UserSession;
}

function makeSessions(session: UserSession) {
  return {
    read: () => [session],
    subscribe: () => () => undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createAllowanceService', () => {
  describe('getBulletinSigner', () => {
    it('requests from mobile on cache miss and persists the slot account key', async () => {
      const session = makeSession();
      const repository = createAllowanceRepository('salt', createMemoryAdapter());
      vi.mocked(session.requestResourceAllocation).mockReturnValue(
        okAsync([
          {
            tag: 'Allocated',
            value: { tag: 'BulletInAllowance', value: { slotAccountKey: FAKE_SECRET } },
          },
        ]),
      );
      const service = createAllowanceService({ sessions: makeSessions(session), repository });

      const result = await service.getBulletinSigner('session-1', 'product.dot');

      expect(result.isOk()).toBe(true);
      expect(session.requestResourceAllocation).toHaveBeenCalledWith({
        callingProductId: 'product.dot',
        resources: [{ tag: 'BulletInAllowance', value: undefined }],
        onExisting: 'Ignore',
      });

      const cached = await repository.read('session-1', 'product.dot', 'bulletin');
      expect(cached._unsafeUnwrap()).toEqual(FAKE_SECRET);
    });

    it('uses cached key on cache hit without calling the session', async () => {
      const session = makeSession();
      const repository = createAllowanceRepository('salt', createMemoryAdapter());
      await repository.write('session-1', 'product.dot', 'bulletin', FAKE_SECRET);
      const service = createAllowanceService({ sessions: makeSessions(session), repository });

      const result = await service.getBulletinSigner('session-1', 'product.dot');

      expect(result.isOk()).toBe(true);
      expect(session.requestResourceAllocation).not.toHaveBeenCalled();
    });

    it('returns Rejected error when mobile rejects', async () => {
      const session = makeSession();
      const repository = createAllowanceRepository('salt', createMemoryAdapter());
      vi.mocked(session.requestResourceAllocation).mockReturnValue(okAsync([{ tag: 'Rejected', value: undefined }]));
      const service = createAllowanceService({ sessions: makeSessions(session), repository });

      const result = await service.getBulletinSigner('session-1', 'product.dot');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().reason).toBe('Rejected');
    });

    it('returns NotAvailable error when mobile reports unavailable', async () => {
      const session = makeSession();
      const repository = createAllowanceRepository('salt', createMemoryAdapter());
      vi.mocked(session.requestResourceAllocation).mockReturnValue(
        okAsync([{ tag: 'NotAvailable', value: undefined }]),
      );
      const service = createAllowanceService({ sessions: makeSessions(session), repository });

      const result = await service.getBulletinSigner('session-1', 'product.dot');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().reason).toBe('NotAvailable');
    });

    it('returns NoSession when sessionId does not match an active session', async () => {
      const session = makeSession();
      const repository = createAllowanceRepository('salt', createMemoryAdapter());
      const service = createAllowanceService({ sessions: makeSessions(session), repository });

      const result = await service.getBulletinSigner('unknown-session', 'product.dot');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().reason).toBe('NoSession');
    });

    it('returns UnexpectedResponse when mobile returns the wrong resource tag', async () => {
      const session = makeSession();
      const repository = createAllowanceRepository('salt', createMemoryAdapter());
      vi.mocked(session.requestResourceAllocation).mockReturnValue(
        okAsync([
          {
            tag: 'Allocated',
            value: { tag: 'StatementStoreAllowance', value: { slotAccountKey: FAKE_SECRET } },
          },
        ]),
      );
      const service = createAllowanceService({ sessions: makeSessions(session), repository });

      const result = await service.getBulletinSigner('session-1', 'product.dot');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().reason).toBe('UnexpectedResponse');
    });

    it('propagates session.requestResourceAllocation errors', async () => {
      const session = makeSession();
      const repository = createAllowanceRepository('salt', createMemoryAdapter());
      vi.mocked(session.requestResourceAllocation).mockReturnValue(errAsync(new Error('transport down')));
      const service = createAllowanceService({ sessions: makeSessions(session), repository });

      const result = await service.getBulletinSigner('session-1', 'product.dot');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().reason).toBe('UnexpectedResponse');
    });
  });

  describe('getStatementStoreProver', () => {
    beforeAll(async () => {
      await ensureSubstrateSlotSr25519Ready();
    });

    it('returns a prover that signs under the slot-derived public key', async () => {
      const slotSecret = substrateSlotSecretFromSeedBytes(mnemonicToMiniSecret(DEV_MNEMONIC));
      const session = makeSession();
      const repository = createAllowanceRepository('salt', createMemoryAdapter());
      vi.mocked(session.requestResourceAllocation).mockReturnValue(
        okAsync([
          {
            tag: 'Allocated',
            value: { tag: 'StatementStoreAllowance', value: { slotAccountKey: slotSecret } },
          },
        ]),
      );
      const service = createAllowanceService({ sessions: makeSessions(session), repository });

      const proverResult = await service.getStatementStoreProver('session-1', 'product.dot');

      expect(proverResult.isOk()).toBe(true);

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
      const session = makeSession();
      const repository = createAllowanceRepository('salt', createMemoryAdapter());
      vi.mocked(session.requestResourceAllocation).mockReturnValue(
        okAsync([
          {
            tag: 'Allocated',
            value: { tag: 'StatementStoreAllowance', value: { slotAccountKey: ANOTHER_SECRET } },
          },
        ]),
      );
      const service = createAllowanceService({ sessions: makeSessions(session), repository });

      const result = await service.getStatementStoreProver('session-1', 'product.dot');

      expect(result.isOk()).toBe(true);
      expect(session.requestResourceAllocation).toHaveBeenCalledWith({
        callingProductId: 'product.dot',
        resources: [{ tag: 'StatementStoreAllowance', value: undefined }],
        onExisting: 'Ignore',
      });

      const cached = await repository.read('session-1', 'product.dot', 'statementStore');
      expect(cached._unsafeUnwrap()).toEqual(ANOTHER_SECRET);

      // bulletin slot must remain empty
      const bulletinCached = await repository.read('session-1', 'product.dot', 'bulletin');
      expect(bulletinCached._unsafeUnwrap()).toBeNull();
    });
  });
});
