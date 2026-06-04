import { p256 } from '@noble/curves/nist.js';
import type { Statement, StatementStoreAdapter } from '@novasamatech/statement-store';
import { createEncryption } from '@novasamatech/statement-store';
import { okAsync } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { onHostPappDebugMessage } from '../src/debugBus.js';
import type { HostPappDebugEvent } from '../src/debugTypes.js';
import { createAuth } from '../src/sso/auth/impl.js';
import { HandshakeSuccessV2, VersionedHandshakeResponse } from '../src/sso/auth/scale/handshakeV2.js';
import type { DeviceIdentityForPairing } from '../src/sso/auth/v2/service.js';
import type { DeviceIdentityStore } from '../src/sso/deviceIdentityStore.js';
import type { UserSecretRepository } from '../src/sso/userSecretRepository.js';
import type { UserSessionRepository } from '../src/sso/userSessionRepository.js';

const DEVICE_ENC_PRIV = new Uint8Array(32).fill(0x22);
const DEVICE_ENC_PUB = p256.getPublicKey(DEVICE_ENC_PRIV, false);
const DEVICE_STMT_ACCT = new Uint8Array(32).fill(0x33);
const DEVICE_STMT_SECRET = new Uint8Array(64).fill(0x55);

const IDENTITY_CHAT_PRIV = new Uint8Array(32).fill(0xdd);
const IDENTITY_ACCT = new Uint8Array(32).fill(0xa1);
const ROOT_ACCT = new Uint8Array(32).fill(0xa2);
const SSO_ENC_PUB = new Uint8Array(65).fill(0x06);
const PEER_STMT_ACCT_HEX = '0x' + '44'.repeat(32);

const makeDeviceIdentity = (): DeviceIdentityForPairing => ({
  statementAccountPublicKey: DEVICE_STMT_ACCT,
  statementAccountSecret: DEVICE_STMT_SECRET,
  encryptionPublicKey: DEVICE_ENC_PUB,
  encryptionPrivateKey: DEVICE_ENC_PRIV,
});

const stubDeviceIdentityStore = (): DeviceIdentityStore =>
  ({
    loadOrCreate: vi.fn(() => okAsync({ ...makeDeviceIdentity(), statementAccountSecret: DEVICE_STMT_SECRET })),
    readLastProcessedHandshakeStatement: vi.fn(() => okAsync(null)),
    writeLastProcessedHandshakeStatement: vi.fn(() => okAsync(undefined)),
  }) as unknown as DeviceIdentityStore;

const buildSuccessStatement = (): Statement => {
  const inner = HandshakeSuccessV2.enc({
    identityAccountId: IDENTITY_ACCT,
    rootAccountId: ROOT_ACCT,
    identityChatPrivateKey: IDENTITY_CHAT_PRIV,
    ssoEncPubKey: SSO_ENC_PUB,
    deviceEncPubKey: DEVICE_ENC_PUB,
  });
  // The inner body is a length-dispatched Success (226-byte v0.2.2 payload).
  // Wrap it as the discriminated `EncryptedHandshakeResponseV2::Success` for
  // the envelope.
  const successEnvelope = new Uint8Array(inner.length + 1);
  successEnvelope[0] = 1; // Success discriminant
  successEnvelope.set(inner, 1);

  // ECDH-encrypt: peer (PApp) uses ephemeral tmpKey + device.encPub
  const tmpPriv = new Uint8Array(32).fill(0x77);
  const tmpPub = p256.getPublicKey(tmpPriv, false);
  const shared = p256.getSharedSecret(tmpPriv, DEVICE_ENC_PUB).slice(1, 33);
  const enc = createEncryption(shared as never);
  const encrypted = enc.encrypt(successEnvelope)._unsafeUnwrap();

  const statementData = VersionedHandshakeResponse.enc({
    tag: 'V2',
    value: { encrypted, tmpKey: tmpPub },
  });

  return {
    data: statementData,
    proof: { type: 'sr25519', value: { signature: '0x' + '00'.repeat(64), signer: PEER_STMT_ACCT_HEX } },
  } as Statement;
};

type Deliver = (page: { statements: Statement[]; isComplete: boolean }) => void;

const buildHarness = (overrides: { onAuthSuccess?: () => Promise<void> } = {}) => {
  let deliver: Deliver | null = null;
  const unsubscribe = vi.fn();
  const subscribeStatements = vi.fn((_filter: unknown, onPage: Deliver) => {
    deliver = onPage;
    return unsubscribe;
  });
  const queryStatements = vi.fn(() => okAsync([]));

  const statementStore = { subscribeStatements, queryStatements } as unknown as StatementStoreAdapter;

  const ssoSessionRepository = { add: vi.fn(() => okAsync(undefined)) } as unknown as UserSessionRepository;
  const userSecretRepository = { write: vi.fn(() => okAsync(undefined)) } as unknown as UserSecretRepository;
  const deviceIdentityStore = stubDeviceIdentityStore();

  const auth = createAuth({
    hostMetadata: { hostName: 'Test Host' },
    deviceIdentity: makeDeviceIdentity,
    deviceIdentityStore,
    statementStore,
    ssoSessionRepository,
    userSecretRepository,
    onAuthSuccess: overrides.onAuthSuccess,
  });

  return {
    auth,
    subscribeStatements,
    queryStatements,
    unsubscribe,
    ssoSessionRepository,
    userSecretRepository,
    deviceIdentityStore,
    async waitForSubscription() {
      await vi.waitFor(() => expect(subscribeStatements).toHaveBeenCalledTimes(1));
    },
    deliver(statements: Statement[]) {
      if (!deliver) throw new Error('subscribeStatements not yet called');
      deliver({ statements, isComplete: true });
    },
  };
};

describe('createAuth', () => {
  describe('initial state', () => {
    it('starts with pairingStatus at "none"', () => {
      const { auth } = buildHarness();
      expect(auth.pairingStatus.read()).toEqual({ step: 'none' });
    });
  });

  describe('authenticate (success path)', () => {
    it('returns the same in-flight ResultAsync on concurrent calls', () => {
      const { auth } = buildHarness();
      const first = auth.authenticate();
      const second = auth.authenticate();
      expect(second).toBe(first);
    });

    it('persists the session and resolves with a StoredUserSession on Success', async () => {
      const harness = buildHarness();
      const promise = harness.auth.authenticate();
      await harness.waitForSubscription();
      harness.deliver([buildSuccessStatement()]);

      const result = await promise;
      expect(result.isOk()).toBe(true);
      const session = result._unsafeUnwrap();
      expect(session).not.toBeNull();
      expect(session!.identityAccountId).toEqual(IDENTITY_ACCT);
      expect(session!.remoteAccount.accountId).toEqual(new Uint8Array(32).fill(0x44));
      expect(harness.ssoSessionRepository.add).toHaveBeenCalledOnce();
      expect(harness.userSecretRepository.write).toHaveBeenCalledOnce();
      const secretsCall = (harness.userSecretRepository.write as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(secretsCall?.[1]).toMatchObject({ identityChatPrivateKey: IDENTITY_CHAT_PRIV });
    });

    it('emits pairingStatus transitions: none -> initial -> pairing(deeplink) -> finished(session)', async () => {
      const harness = buildHarness();
      const observed: { step: string; payload?: string; session?: { id: string } }[] = [];
      harness.auth.pairingStatus.subscribe(s => observed.push(s as never));

      const promise = harness.auth.authenticate();
      await harness.waitForSubscription();
      harness.deliver([buildSuccessStatement()]);
      await promise;

      const steps = observed.map(s => s.step);
      expect(steps[0]).toBe('none');
      expect(steps).toContain('initial');
      const pairing = observed.find(s => s.step === 'pairing');
      expect(pairing?.payload).toMatch(/^polkadotapp:\/\/pair\?handshake=/);
      const finished = observed.find(s => s.step === 'finished');
      expect(finished?.session).toBeDefined();
      expect(finished?.session?.id).toBeTypeOf('string');
    });

    it('runs the onAuthSuccess hook with session + identityChatPrivateKey + ssoEncPubKey after internal persistence', async () => {
      const onAuthSuccess = vi.fn(() => Promise.resolve());
      const harness = buildHarness({ onAuthSuccess });

      const promise = harness.auth.authenticate();
      await harness.waitForSubscription();
      harness.deliver([buildSuccessStatement()]);
      const result = await promise;

      expect(result.isOk()).toBe(true);
      expect(onAuthSuccess).toHaveBeenCalledTimes(1);
      const arg = (
        onAuthSuccess.mock.calls[0] as unknown as [
          { session: { id: string }; identityChatPrivateKey: Uint8Array; ssoEncPubKey: Uint8Array | null },
        ]
      )[0];
      expect(arg.session.id).toBeTypeOf('string');
      expect(arg.identityChatPrivateKey).toEqual(IDENTITY_CHAT_PRIV);
      expect(arg.ssoEncPubKey).toEqual(SSO_ENC_PUB);
    });

    it('fails authenticate when onAuthSuccess throws', async () => {
      const onAuthSuccess = vi.fn(() => Promise.reject(new Error('hook boom')));
      const harness = buildHarness({ onAuthSuccess });

      const promise = harness.auth.authenticate();
      await harness.waitForSubscription();
      harness.deliver([buildSuccessStatement()]);

      const result = await promise;
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('hook boom');
      expect(harness.auth.pairingStatus.read()).toEqual({ step: 'pairingError', message: 'hook boom' });
    });
  });

  describe('authenticate (error paths)', () => {
    it('publishes pairingError on a Failed inner response', async () => {
      const harness = buildHarness();
      const failedStatement: Statement = {
        data: VersionedHandshakeResponse.enc({
          tag: 'V2',
          value: (() => {
            const enc = createEncryption(
              p256.getSharedSecret(new Uint8Array(32).fill(0x66), DEVICE_ENC_PUB).slice(1, 33) as never,
            );
            // Failed body = enum index 2 + SCALE-compact length (8 << 2 = 0x20) + "declined"
            const failedPayload = new Uint8Array([2, 0x20, 0x64, 0x65, 0x63, 0x6c, 0x69, 0x6e, 0x65, 0x64]);
            return {
              encrypted: enc.encrypt(failedPayload)._unsafeUnwrap(),
              tmpKey: p256.getPublicKey(new Uint8Array(32).fill(0x66), false),
            };
          })(),
        }),
        proof: { type: 'sr25519', value: { signature: '0x' + '00'.repeat(64), signer: PEER_STMT_ACCT_HEX } },
      } as Statement;

      const promise = harness.auth.authenticate();
      await harness.waitForSubscription();
      harness.deliver([failedStatement]);

      const result = await promise;
      expect(result.isErr()).toBe(true);
      expect(harness.auth.pairingStatus.read()).toEqual({ step: 'pairingError', message: 'declined' });
    });
  });

  describe('abortAuthentication', () => {
    it('resolves the in-flight authenticate with ok(null) and resets status', async () => {
      const harness = buildHarness();
      const promise = harness.auth.authenticate();
      await harness.waitForSubscription();
      harness.auth.abortAuthentication();

      const result = await promise;
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
      expect(harness.auth.pairingStatus.read()).toEqual({ step: 'none' });
    });

    it('clears the cached result so the next call starts a fresh attempt', async () => {
      const harness = buildHarness();
      const first = harness.auth.authenticate();
      await harness.waitForSubscription();
      harness.auth.abortAuthentication();
      await first;

      const second = harness.auth.authenticate();
      expect(second).not.toBe(first);
      await vi.waitFor(() => expect(harness.subscribeStatements).toHaveBeenCalledTimes(2));
      harness.auth.abortAuthentication();
      await second;
    });

    it('is a no-op when no authentication is in flight', () => {
      const { auth } = buildHarness();
      expect(() => auth.abortAuthentication()).not.toThrow();
      expect(auth.pairingStatus.read()).toEqual({ step: 'none' });
    });
  });

  describe('default deviceIdentity', () => {
    it('falls back to deviceIdentityStore.loadOrCreate when no deviceIdentity factory is provided', async () => {
      let deliver: Deliver | null = null;
      const unsubscribe = vi.fn();
      const subscribeStatements = vi.fn((_filter: unknown, onPage: Deliver) => {
        deliver = onPage;
        return unsubscribe;
      });
      const queryStatements = vi.fn(() => okAsync([]));
      const statementStore = { subscribeStatements, queryStatements } as unknown as StatementStoreAdapter;
      const ssoSessionRepository = { add: vi.fn(() => okAsync(undefined)) } as unknown as UserSessionRepository;
      const userSecretRepository = { write: vi.fn(() => okAsync(undefined)) } as unknown as UserSecretRepository;
      const deviceIdentityStore = stubDeviceIdentityStore();

      const auth = createAuth({
        deviceIdentityStore,
        statementStore,
        ssoSessionRepository,
        userSecretRepository,
      });

      const promise = auth.authenticate();
      await vi.waitFor(() => expect(subscribeStatements).toHaveBeenCalledTimes(1));
      expect(deviceIdentityStore.loadOrCreate).toHaveBeenCalledOnce();
      if (deliver) (deliver as Deliver)({ statements: [buildSuccessStatement()], isComplete: true });
      await promise;
    });
  });

  describe('debug emits', () => {
    function captureEvents() {
      const events: HostPappDebugEvent[] = [];
      const unsubscribe = onHostPappDebugMessage(event => events.push(event));
      return { events, unsubscribe };
    }

    it('emits pairing_started eagerly when authenticate() is called', async () => {
      const { auth } = buildHarness();
      const { events, unsubscribe } = captureEvents();
      try {
        void auth.authenticate();
        await vi.waitFor(() => {
          expect(events.find(e => e.layer === 'sso' && e.event === 'pairing_started')).toBeTruthy();
        });
      } finally {
        auth.abortAuthentication();
        unsubscribe();
      }
    });

    it('emits the full SSO pairing sequence on a successful authenticate', async () => {
      const harness = buildHarness();
      const { events, unsubscribe } = captureEvents();
      try {
        const promise = harness.auth.authenticate();
        await harness.waitForSubscription();
        harness.deliver([buildSuccessStatement()]);
        const result = await promise;
        expect(result.isOk()).toBe(true);

        const ssoSequence = events.filter(e => e.layer === 'sso').map(e => e.event);
        expect(ssoSequence).toEqual([
          'pairing_started',
          'deeplink_generated',
          'awaiting_response',
          'response_received',
          'session_established',
        ]);
      } finally {
        unsubscribe();
      }
    });

    it('does not emit pairing_failed when authentication is aborted by the user', async () => {
      const harness = buildHarness();
      const { events, unsubscribe } = captureEvents();
      try {
        const promise = harness.auth.authenticate();
        await harness.waitForSubscription();
        harness.auth.abortAuthentication();
        const result = await promise;

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toBeNull();
        expect(events.some(e => e.layer === 'sso' && e.event === 'pairing_failed')).toBe(false);
      } finally {
        unsubscribe();
      }
    });
  });
});

beforeEach(() => {
  vi.useRealTimers();
});
