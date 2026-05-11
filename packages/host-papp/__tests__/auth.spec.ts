import type { LazyClient, Statement, StatementStoreAdapter } from '@novasamatech/statement-store';
import { errAsync, ok, okAsync } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuth } from '../src/sso/auth/impl.js';
import type { UserSecretRepository } from '../src/sso/userSecretRepository.js';
import type { UserSessionRepository } from '../src/sso/userSessionRepository.js';

const mocks = vi.hoisted(() => ({
  grantVerifierAllowance: vi.fn(),
  registerLitePerson: vi.fn(),
  claimUsername: vi.fn(),
  decrypt: vi.fn(),
  generateMnemonic: vi.fn(),
  handshakeEnc: vi.fn(),
  responsePayloadDec: vi.fn(),
  responseSensitiveDec: vi.fn(),
}));

vi.mock('@polkadot-labs/hdkd-helpers', async importOriginal => {
  const actual = await importOriginal<typeof import('@polkadot-labs/hdkd-helpers')>();
  return {
    ...actual,
    generateMnemonic: mocks.generateMnemonic,
  };
});

vi.mock('../src/crypto.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/crypto.js')>();
  return {
    ...actual,
    deriveSr25519Account: vi.fn(() => ({
      secret: new Uint8Array(64),
      publicKey: new Uint8Array(32),
      entropy: new Uint8Array(32),
      sign: vi.fn(),
      verify: vi.fn(() => true),
    })),
    createEncrSecret: vi.fn(() => new Uint8Array(32)),
    getEncrPub: vi.fn(() => new Uint8Array(65)),
    createSharedSecret: vi.fn(() => new Uint8Array(32)),
  };
});

vi.mock('../src/sso/auth/attestationService.js', () => ({
  createAttestationService: vi.fn(() => ({
    claimUsername: mocks.claimUsername,
    grantVerifierAllowance: mocks.grantVerifierAllowance,
    registerLitePerson: mocks.registerLitePerson,
  })),
  createSudoAliceVerifier: vi.fn(() => ({
    secret: new Uint8Array(64),
    publicKey: new Uint8Array(32),
    entropy: new Uint8Array(32),
    sign: vi.fn(),
    verify: vi.fn(() => true),
  })),
}));

vi.mock('../src/sso/auth/scale/handshake.js', () => ({
  HandshakeData: { enc: mocks.handshakeEnc },
  HandshakeResponsePayload: { dec: mocks.responsePayloadDec },
  HandshakeResponseSensitiveData: { dec: mocks.responseSensitiveDec },
}));

vi.mock('@novasamatech/statement-store', async importOriginal => {
  const actual = await importOriginal<typeof import('@novasamatech/statement-store')>();
  return {
    ...actual,
    createAccountId: vi.fn((bytes: Uint8Array) => bytes as never),
    createLocalSessionAccount: vi.fn((accountId: unknown) => ({ accountId, kind: 'local' }) as never),
    createRemoteSessionAccount: vi.fn(
      (accountId: unknown, secret: unknown) => ({ accountId, secret, kind: 'remote' }) as never,
    ),
    createEncryption: vi.fn(() => ({ decrypt: mocks.decrypt })),
    khash: vi.fn(() => new Uint8Array([42, 42, 42])),
  };
});

vi.mock('../src/sso/userSessionRepository.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/sso/userSessionRepository.js')>();
  return {
    ...actual,
    createStoredUserSession: vi.fn(
      (localAccount: unknown, remoteAccount: unknown, identityAccountId: unknown) =>
        ({
          id: 'session-id-1',
          localAccount,
          remoteAccount,
          identityAccountId,
        }) as never,
    ),
  };
});

type DeliverFn = (statements: Statement[]) => void;

function buildHarness() {
  let deliver: DeliverFn | null = null;
  const unsubscribe = vi.fn();
  const subscribeStatements = vi.fn((_filter: unknown, onPage: (page: { statements: Statement[] }) => void) => {
    deliver = (statements: Statement[]) => onPage({ statements });
    return unsubscribe;
  });

  const statementStore = { subscribeStatements };
  const ssoSessionRepository = { add: vi.fn(() => okAsync(undefined)) };
  const userSecretRepository = { write: vi.fn(() => okAsync(undefined)) };
  const lazyClient = { getClient: () => ({ getUnsafeApi: () => ({}) }) };

  const auth = createAuth({
    metadata: 'test-metadata',
    hostMetadata: { hostVersion: '1.0', osType: 'iOS', osVersion: '18' },
    statementStore: statementStore as unknown as StatementStoreAdapter,
    ssoSessionRepository: ssoSessionRepository as unknown as UserSessionRepository,
    userSecretRepository: userSecretRepository as unknown as UserSecretRepository,
    lazyClient: lazyClient as unknown as LazyClient,
  });

  return {
    auth,
    statementStore,
    ssoSessionRepository,
    userSecretRepository,
    subscribeStatements,
    unsubscribe,
    async waitForSubscription(times = 1) {
      await vi.waitFor(() => expect(subscribeStatements).toHaveBeenCalledTimes(times));
    },
    deliverHandshake() {
      if (!deliver) throw new Error('subscribeStatements not yet called');
      deliver([{ data: new Uint8Array([0xde, 0xad]) } as Statement]);
    },
    deliverPage(statements: Statement[]) {
      if (!deliver) throw new Error('subscribeStatements not yet called');
      deliver(statements);
    },
  };
}

beforeEach(() => {
  mocks.grantVerifierAllowance.mockReset().mockReturnValue(okAsync(undefined));
  mocks.registerLitePerson.mockReset().mockReturnValue(okAsync(undefined));
  mocks.claimUsername.mockReset().mockReturnValue('guestabcd.1234');
  mocks.decrypt.mockReset().mockReturnValue(ok(new Uint8Array([7, 7, 7])));
  mocks.generateMnemonic.mockReset().mockReturnValue('test mnemonic');
  mocks.handshakeEnc.mockReset().mockReturnValue(new Uint8Array([0xab, 0xcd]));
  mocks.responsePayloadDec.mockReset().mockReturnValue({
    tag: 'v1',
    value: { encrypted: new Uint8Array([1, 2]), tmpKey: new Uint8Array(65) },
  });
  mocks.responseSensitiveDec.mockReset().mockReturnValue({
    sharedSecretDerivationKey: new Uint8Array(65),
    rootUserAccountId: new Uint8Array(32),
    identityAccountId: new Uint8Array(32),
  });
});

describe('createAuth', () => {
  describe('initial state', () => {
    it('starts with both statuses at "none"', () => {
      const { auth } = buildHarness();
      expect(auth.pairingStatus.read()).toEqual({ step: 'none' });
      expect(auth.attestationStatus.read()).toEqual({ step: 'none' });
    });
  });

  describe('authenticate (success path)', () => {
    it('returns the same in-flight ResultAsync on concurrent calls', () => {
      const { auth } = buildHarness();

      const first = auth.authenticate();
      const second = auth.authenticate();

      expect(second).toBe(first);
    });

    it('resolves with stored session and persists secrets and session', async () => {
      const harness = buildHarness();
      const { auth, ssoSessionRepository, userSecretRepository } = harness;

      const promise = auth.authenticate();
      await harness.waitForSubscription();
      harness.deliverHandshake();

      const result = await promise;

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toMatchObject({ id: 'session-id-1' });
      expect(userSecretRepository.write).toHaveBeenCalledWith(
        'session-id-1',
        expect.objectContaining({
          ssSecret: expect.any(Uint8Array),
          encrSecret: expect.any(Uint8Array),
          entropy: expect.any(Uint8Array),
        }),
      );
      expect(ssoSessionRepository.add).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-id-1' }));
    });

    it('caches the resolved result so subsequent calls return the same ResultAsync', async () => {
      const harness = buildHarness();
      const { auth } = harness;

      const promise = auth.authenticate();
      await harness.waitForSubscription();
      harness.deliverHandshake();
      await promise;

      const second = auth.authenticate();
      expect(second).toBe(promise);
      expect(mocks.generateMnemonic).toHaveBeenCalledTimes(1);
    });

    it('emits pairingStatus transitions: none -> initial -> pairing(deeplink) -> finished', async () => {
      const harness = buildHarness();
      const { auth } = harness;
      const observed: Array<{ step: string; payload?: string }> = [];
      auth.pairingStatus.subscribe(s => observed.push(s as never));

      const promise = auth.authenticate();
      await harness.waitForSubscription();
      harness.deliverHandshake();
      await promise;

      const steps = observed.map(s => s.step);
      expect(steps[0]).toBe('none');
      expect(steps).toContain('initial');
      const pairing = observed.find(s => s.step === 'pairing');
      expect(pairing?.payload).toBe('polkadotapp://pair?handshake=0xabcd');
      expect(steps.at(-1)).toBe('finished');
    });

    it('emits attestationStatus transitions: none -> attestation(username) -> finished', async () => {
      const harness = buildHarness();
      const { auth } = harness;
      const observed: Array<{ step: string; username?: string }> = [];
      auth.attestationStatus.subscribe(s => observed.push(s as never));

      const promise = auth.authenticate();
      await harness.waitForSubscription();
      harness.deliverHandshake();
      await promise;

      expect(observed[0]?.step).toBe('none');
      const attestation = observed.find(s => s.step === 'attestation');
      expect(attestation).toEqual({ step: 'attestation', username: 'guestabcd.1234' });
      expect(observed.at(-1)?.step).toBe('finished');
    });

    it('skips statements with no data and resolves on the first decryptable one', async () => {
      const harness = buildHarness();
      const { auth, ssoSessionRepository } = harness;

      const promise = auth.authenticate();
      await harness.waitForSubscription();
      harness.deliverPage([{ data: undefined } as Statement, { data: new Uint8Array([1, 2, 3]) } as Statement]);
      const result = await promise;

      expect(result.isOk()).toBe(true);
      expect(ssoSessionRepository.add).toHaveBeenCalledTimes(1);
    });
  });

  describe('authenticate (error paths)', () => {
    it('publishes attestationError and rejects when registration fails', async () => {
      mocks.registerLitePerson.mockReturnValue(errAsync(new Error('chain offline')));
      const harness = buildHarness();
      const { auth } = harness;

      const promise = auth.authenticate();
      await harness.waitForSubscription();
      harness.deliverHandshake();
      const result = await promise;

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('chain offline');
      expect(auth.attestationStatus.read()).toEqual({
        step: 'attestationError',
        message: 'chain offline',
      });
    });

    it('publishes pairingError when retrieving the session throws', async () => {
      mocks.responsePayloadDec.mockImplementation(() => {
        throw new Error('payload broken');
      });
      const harness = buildHarness();
      const { auth } = harness;

      const promise = auth.authenticate();
      await harness.waitForSubscription();
      harness.deliverHandshake();
      const result = await promise;

      expect(result.isErr()).toBe(true);
      expect(auth.pairingStatus.read()).toEqual({
        step: 'pairingError',
        message: 'payload broken',
      });
    });

    it('publishes pairingError when payload encoding throws synchronously', async () => {
      mocks.handshakeEnc.mockImplementation(() => {
        throw new Error('encode broken');
      });
      const { auth } = buildHarness();

      const result = await auth.authenticate();

      expect(result.isErr()).toBe(true);
      expect(auth.pairingStatus.read()).toEqual({
        step: 'pairingError',
        message: 'encode broken',
      });
    });

    it('clears the cached result after failure so the next call retries', async () => {
      mocks.registerLitePerson.mockReturnValueOnce(errAsync(new Error('boom'))).mockReturnValue(okAsync(undefined));

      const harness = buildHarness();
      const { auth } = harness;

      const first = auth.authenticate();
      await harness.waitForSubscription();
      harness.deliverHandshake();
      await first;

      const second = auth.authenticate();
      expect(second).not.toBe(first);
      expect(mocks.generateMnemonic).toHaveBeenCalledTimes(2);

      auth.abortAuthentication();
      await harness.waitForSubscription(2);
      harness.deliverPage([]);
      await second;
    });

    it('does not persist secrets or session when handshake fails', async () => {
      mocks.handshakeEnc.mockImplementation(() => {
        throw new Error('encode broken');
      });
      const harness = buildHarness();
      const { auth, userSecretRepository, ssoSessionRepository } = harness;

      await auth.authenticate();

      expect(userSecretRepository.write).not.toHaveBeenCalled();
      expect(ssoSessionRepository.add).not.toHaveBeenCalled();
    });
  });

  describe('abortAuthentication', () => {
    it('resolves the in-flight authenticate with ok(null)', async () => {
      const harness = buildHarness();
      const { auth } = harness;

      const promise = auth.authenticate();
      await harness.waitForSubscription();
      auth.abortAuthentication();
      // a page must arrive for the subscribe callback to observe the aborted signal
      harness.deliverPage([]);

      const result = await promise;
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });

    it('resets pairing and attestation statuses', async () => {
      const harness = buildHarness();
      const { auth } = harness;

      const promise = auth.authenticate();
      await harness.waitForSubscription();
      auth.abortAuthentication();
      harness.deliverPage([]);
      await promise;

      expect(auth.pairingStatus.read()).toEqual({ step: 'none' });
      expect(auth.attestationStatus.read()).toEqual({ step: 'none' });
    });

    it('does not transition pairingStatus or attestationStatus to error states on user abort', async () => {
      const harness = buildHarness();
      const { auth } = harness;
      const pairing: Array<{ step: string }> = [];
      const attestation: Array<{ step: string }> = [];
      auth.pairingStatus.subscribe(s => pairing.push(s as never));
      auth.attestationStatus.subscribe(s => attestation.push(s as never));

      const promise = auth.authenticate();
      await harness.waitForSubscription();
      auth.abortAuthentication();
      harness.deliverPage([]);
      await promise;

      expect(pairing.some(s => s.step === 'pairingError')).toBe(false);
      expect(attestation.some(s => s.step === 'attestationError')).toBe(false);
    });

    it('clears the cached result so the next call starts a fresh attempt', async () => {
      const harness = buildHarness();
      const { auth } = harness;

      const first = auth.authenticate();
      await harness.waitForSubscription();
      auth.abortAuthentication();
      harness.deliverPage([]);
      await first;

      const second = auth.authenticate();
      expect(second).not.toBe(first);
      expect(mocks.generateMnemonic).toHaveBeenCalledTimes(2);

      auth.abortAuthentication();
      await harness.waitForSubscription(2);
      harness.deliverPage([]);
      await second;
    });

    it('is a no-op when no authentication is in flight', () => {
      const { auth } = buildHarness();
      expect(() => auth.abortAuthentication()).not.toThrow();
      expect(auth.pairingStatus.read()).toEqual({ step: 'none' });
      expect(auth.attestationStatus.read()).toEqual({ step: 'none' });
    });
  });
});
