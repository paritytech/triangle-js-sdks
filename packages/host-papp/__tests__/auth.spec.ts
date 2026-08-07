import { x25519 } from '@noble/curves/ed25519.js';
import { createEncryption, createInMemoryStatementStore } from '@novasamatech/statement-store';
import type { StorageAdapter } from '@novasamatech/storage-adapter';
import { createMemoryAdapter } from '@novasamatech/storage-adapter';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { onHostPappDebugMessage } from '../src/debugBus.js';
import type { HostPappDebugEvent } from '../src/debugTypes.js';
import { createAuth } from '../src/sso/auth/impl.js';
import { HandshakeSuccessV2, VersionedHandshakeResponse } from '../src/sso/auth/scale/handshakeV2.js';
import type { DeviceIdentityForPairing } from '../src/sso/auth/v2/service.js';
import { createDeviceIdentityStore } from '../src/sso/deviceIdentityStore.js';
import { createUserSecretRepository } from '../src/sso/userSecretRepository.js';
import { createUserSessionRepository } from '../src/sso/userSessionRepository.js';

import { publishPairingResponse } from './peerSession.js';

const DEVICE_ENC_PRIV = new Uint8Array(32).fill(0x22);
const DEVICE_ENC_PUB = x25519.getPublicKey(DEVICE_ENC_PRIV);
const DEVICE_STMT_ACCT = new Uint8Array(32).fill(0x33);
const DEVICE_STMT_SECRET = new Uint8Array(64).fill(0x55);

const IDENTITY_CHAT_PRIV = new Uint8Array(32).fill(0xdd);
const IDENTITY_ACCT = new Uint8Array(32).fill(0xa1);
const ROOT_ACCT = new Uint8Array(32).fill(0xa2);
const SSO_ENC_PRIV = new Uint8Array(32).fill(0x06);
const SSO_ENC_PUB = x25519.getPublicKey(SSO_ENC_PRIV);
const EXPECTED_SHARED_SECRET = x25519.getSharedSecret(DEVICE_ENC_PRIV, SSO_ENC_PUB);
const ROOT_ENTROPY_SOURCE = new Uint8Array(32).fill(0x07);
const PEER_STMT_ACCT_HEX = '0x' + '44'.repeat(32);

const makeDeviceIdentity = (): DeviceIdentityForPairing => ({
  statementAccountPublicKey: DEVICE_STMT_ACCT,
  statementAccountSecret: DEVICE_STMT_SECRET,
  encryptionPublicKey: DEVICE_ENC_PUB,
  encryptionPrivateKey: DEVICE_ENC_PRIV,
});

// The real store, with `loadOrCreate` spied so the fallback test can see it was
// consulted. It generates its own keypair on first call, like production.
const spiedDeviceIdentityStore = (storage: StorageAdapter) => {
  const store = createDeviceIdentityStore('auth-test', storage);

  return { ...store, loadOrCreate: vi.fn(store.loadOrCreate) };
};

const wrapSuccessBody = (inner: Uint8Array, recipientEncPub = DEVICE_ENC_PUB): Uint8Array => {
  const successEnvelope = new Uint8Array(inner.length + 1);
  successEnvelope[0] = 1;
  successEnvelope.set(inner, 1);

  const tmpPriv = new Uint8Array(32).fill(0x77);
  const tmpPub = x25519.getPublicKey(tmpPriv);
  const shared = x25519.getSharedSecret(tmpPriv, recipientEncPub);
  const enc = createEncryption(shared as never);
  const encrypted = enc.encrypt(successEnvelope)._unsafeUnwrap();

  const statementData = VersionedHandshakeResponse.enc({
    tag: 'V2',
    value: { encrypted, tmpKey: tmpPub },
  });

  return statementData;
};

const buildSuccessResponse = (recipientEncPub = DEVICE_ENC_PUB): Uint8Array =>
  wrapSuccessBody(
    HandshakeSuccessV2.enc({
      identityAccountId: IDENTITY_ACCT,
      rootAccountId: ROOT_ACCT,
      identityChatPrivateKey: IDENTITY_CHAT_PRIV,
      ssoEncPubKey: SSO_ENC_PUB,
      deviceEncPubKey: DEVICE_ENC_PUB,
      rootEntropySource: ROOT_ENTROPY_SOURCE,
    }),
    recipientEncPub,
  );

const buildHarness = (overrides: { onAuthSuccess?: () => Promise<void> } = {}) => {
  const statementStore = createInMemoryStatementStore();

  const storage = createMemoryAdapter();
  const ssoSessionRepository = createUserSessionRepository(storage);
  const userSecretRepository = createUserSecretRepository('auth-test', storage);
  const deviceIdentityStore = spiedDeviceIdentityStore(storage);

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
    statementStore,
    ssoSessionRepository,
    userSecretRepository,
    deviceIdentityStore,
    async waitForSubscription() {
      await vi.waitFor(() => expect(statementStore.activeSubscriptions()).toBe(1));
    },
    deliver(data: Uint8Array) {
      return publishPairingResponse(statementStore, makeDeviceIdentity(), data, { signer: PEER_STMT_ACCT_HEX });
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
      await harness.deliver(buildSuccessResponse());

      const result = await promise;
      await expect(result).toBeOk();
      const session = result._unsafeUnwrap();
      expect(session).not.toBeNull();
      expect(session!.identityAccountId).toEqual(IDENTITY_ACCT);
      expect(session!.remoteAccount.accountId).toEqual(new Uint8Array(32).fill(0x44));
      expect(session!.remoteAccount.publicKey).toEqual(EXPECTED_SHARED_SECRET);
      expect(session!.ssoEncPubKey).toEqual(SSO_ENC_PUB);
      expect(session!.rootEntropySource).toEqual(ROOT_ENTROPY_SOURCE);
      await expect(harness.ssoSessionRepository.read()).toBeOkWith([session]);
      await expect(harness.userSecretRepository.read(session!.id)).toBeOkWith(
        expect.objectContaining({ identityChatPrivateKey: IDENTITY_CHAT_PRIV }),
      );
    });

    it('emits pairingStatus transitions: none -> initial -> pairing(deeplink) -> finished(session)', async () => {
      const harness = buildHarness();
      const observed: { step: string; payload?: string; session?: { id: string } }[] = [];
      harness.auth.pairingStatus.subscribe(s => observed.push(s as never));

      const promise = harness.auth.authenticate();
      await harness.waitForSubscription();
      await harness.deliver(buildSuccessResponse());
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
      await harness.deliver(buildSuccessResponse());
      const result = await promise;

      await expect(result).toBeOk();
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
      await harness.deliver(buildSuccessResponse());

      const result = await promise;
      await expect(result).toBeErr();
      expect(result._unsafeUnwrapErr().message).toBe('hook boom');
      expect(harness.auth.pairingStatus.read()).toEqual({ step: 'pairingError', message: 'hook boom' });
    });
  });

  describe('authenticate (error paths)', () => {
    it('publishes pairingError on a Failed inner response', async () => {
      const harness = buildHarness();
      const failedResponse = VersionedHandshakeResponse.enc({
        tag: 'V2',
        value: (() => {
          const enc = createEncryption(x25519.getSharedSecret(new Uint8Array(32).fill(0x66), DEVICE_ENC_PUB) as never);
          // Failed body = enum index 2 + SCALE-compact length (8 << 2 = 0x20) + "declined"
          const failedPayload = new Uint8Array([2, 0x20, 0x64, 0x65, 0x63, 0x6c, 0x69, 0x6e, 0x65, 0x64]);
          return {
            encrypted: enc.encrypt(failedPayload)._unsafeUnwrap(),
            tmpKey: x25519.getPublicKey(new Uint8Array(32).fill(0x66)),
          };
        })(),
      });

      const promise = harness.auth.authenticate();
      await harness.waitForSubscription();
      await harness.deliver(failedResponse);

      const result = await promise;
      await expect(result).toBeErr();
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
      await expect(result).toBeOkWith(null);
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
      await harness.waitForSubscription();
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
      const statementStore = createInMemoryStatementStore();
      const storage = createMemoryAdapter();
      const ssoSessionRepository = createUserSessionRepository(storage);
      const userSecretRepository = createUserSecretRepository('auth-test', storage);
      const deviceIdentityStore = spiedDeviceIdentityStore(storage);

      const auth = createAuth({
        deviceIdentityStore,
        statementStore,
        ssoSessionRepository,
        userSecretRepository,
      });

      const promise = auth.authenticate();
      await vi.waitFor(() => expect(statementStore.activeSubscriptions()).toBe(1));

      expect(deviceIdentityStore.loadOrCreate).toHaveBeenCalledOnce();

      // Answer on the topic derived from the identity the STORE generated, and
      // encrypted to its key: pairing only completes if `createAuth` actually
      // used what `loadOrCreate` returned rather than a keypair of its own.
      const device = (await deviceIdentityStore.loadOrCreate())._unsafeUnwrap();
      await publishPairingResponse(statementStore, device, buildSuccessResponse(device.encryptionPublicKey), {
        signer: PEER_STMT_ACCT_HEX,
      });

      await expect(promise).toBeOk();
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
        await harness.deliver(buildSuccessResponse());
        const result = await promise;
        await expect(result).toBeOk();

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

        await expect(result).toBeOkWith(null);
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
