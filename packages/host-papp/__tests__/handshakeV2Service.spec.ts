import { p256 } from '@noble/curves/nist.js';
import type { Statement, StatementStoreAdapter } from '@novasamatech/statement-store';
import { createEncryption } from '@novasamatech/statement-store';
import { okAsync } from 'neverthrow';
import { firstValueFrom, lastValueFrom, take, toArray } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { EncryptedHandshakeResponseV2, VersionedHandshakeResponse } from '../src/sso/auth/scale/handshakeV2.js';
import type { DeviceIdentityForPairing } from '../src/sso/auth/v2/service.js';
import { startPairingV2 } from '../src/sso/auth/v2/service.js';
import { computePairingTopic } from '../src/sso/auth/v2/topic.js';

const ecdhX = (priv: Uint8Array, pub: Uint8Array): Uint8Array => p256.getSharedSecret(priv, pub).slice(1, 33);

const buildDeviceIdentity = (): DeviceIdentityForPairing => {
  const encryptionPrivateKey = p256.utils.randomSecretKey();
  return {
    statementAccountPublicKey: new Uint8Array(32).fill(0xa1),
    statementAccountSecret: new Uint8Array(64).fill(0x55),
    encryptionPrivateKey,
    encryptionPublicKey: p256.getPublicKey(encryptionPrivateKey, false),
  };
};

const wrapInnerResponse = (
  device: DeviceIdentityForPairing,
  inner: Uint8Array,
): { encrypted: Uint8Array; tmpKey: Uint8Array } => {
  const tmpPrivate = p256.utils.randomSecretKey();
  const tmpKey = p256.getPublicKey(tmpPrivate, false);
  const shared = ecdhX(tmpPrivate, device.encryptionPublicKey);
  const result = createEncryption(shared).encrypt(inner);
  if (result.isErr()) throw result.error;
  return { encrypted: result.value, tmpKey };
};

const buildStatement = (device: DeviceIdentityForPairing, innerBytes: Uint8Array): Statement => {
  const envelope = wrapInnerResponse(device, innerBytes);
  return {
    data: VersionedHandshakeResponse.enc({ tag: 'V2', value: envelope }),
  };
};

type FakeAdapter = StatementStoreAdapter & { emit: (statements: Statement[]) => void; lastFilter?: unknown };

const makeFakeStore = (): FakeAdapter => {
  let cb: ((page: { statements: Statement[]; isComplete: boolean }) => unknown) | null = null;
  const adapter: FakeAdapter = {
    queryStatements: vi.fn().mockReturnValue(okAsync([])),
    submitStatement: vi.fn(),
    subscribeStatements: vi.fn((filter, callback) => {
      adapter.lastFilter = filter;
      cb = callback;
      return () => {
        cb = null;
      };
    }),
    emit: stmts => {
      cb?.({ statements: stmts, isComplete: false });
    },
  };
  return adapter;
};

describe('startPairingV2', () => {
  it('exposes a polkadotapp:// pairing deeplink as qrPayload', () => {
    const device = buildDeviceIdentity();
    const store = makeFakeStore();

    const pairing = startPairingV2({
      statementStore: store,
      deviceIdentity: device,
      metadata: { hostName: 'Polkadot Desktop' },
    });

    expect(pairing.qrPayload).toMatch(/^polkadotapp:\/\/pair\?handshake=[0-9a-f]+$/);
    pairing.abort();
  });

  it('subscribes to the device pairing topic on startup', () => {
    const device = buildDeviceIdentity();
    const store = makeFakeStore();

    const pairing = startPairingV2({
      statementStore: store,
      deviceIdentity: device,
      metadata: {},
    });

    const expectedTopic = computePairingTopic(device.statementAccountPublicKey, device.encryptionPublicKey);
    expect(store.lastFilter).toEqual({ matchAll: [expectedTopic] });
    pairing.abort();
  });

  it('starts in Submitted state', async () => {
    const device = buildDeviceIdentity();
    const store = makeFakeStore();
    const pairing = startPairingV2({ statementStore: store, deviceIdentity: device, metadata: {} });

    const first = await firstValueFrom(pairing.state$);
    expect(first.tag).toBe('Submitted');
    pairing.abort();
  });

  it('transitions Submitted → Pending → Success on the canonical response sequence', async () => {
    const device = buildDeviceIdentity();
    const store = makeFakeStore();
    const persistOnSuccess = vi.fn().mockResolvedValue(undefined);
    const pairing = startPairingV2({
      statementStore: store,
      deviceIdentity: device,
      metadata: {},
      persistOnSuccess,
    });

    const states$ = pairing.state$.pipe(take(3), toArray());
    const collected = lastValueFrom(states$);

    const pendingBytes = EncryptedHandshakeResponseV2.enc({
      tag: 'Pending',
      value: { tag: 'AllowanceAllocation', value: undefined },
    });
    store.emit([buildStatement(device, pendingBytes)]);

    const successBytes = EncryptedHandshakeResponseV2.enc({
      tag: 'Success',
      value: {
        identityAccountId: new Uint8Array(32).fill(0xa1),
        rootAccountId: new Uint8Array(32).fill(0xa2),
        identityChatPrivateKey: new Uint8Array(32).fill(0xdd),
        ssoEncPubKey: new Uint8Array(65).fill(0x06),
        deviceEncPubKey: new Uint8Array(65).fill(0x04),
      },
    });
    store.emit([buildStatement(device, successBytes)]);

    const states = await collected;
    expect(states.map(s => s.tag)).toEqual(['Submitted', 'Pending', 'Success']);
    expect(persistOnSuccess).toHaveBeenCalledOnce();
    expect(persistOnSuccess).toHaveBeenCalledWith(expect.objectContaining({ tag: 'Success' }));
    pairing.abort();
  });

  it('transitions to Failed on a Failed inner response', async () => {
    const device = buildDeviceIdentity();
    const store = makeFakeStore();
    const pairing = startPairingV2({ statementStore: store, deviceIdentity: device, metadata: {} });

    const states$ = pairing.state$.pipe(take(2), toArray());
    const collected = lastValueFrom(states$);

    const failedBytes = EncryptedHandshakeResponseV2.enc({ tag: 'Failed', value: 'duplicate' });
    store.emit([buildStatement(device, failedBytes)]);

    const states = await collected;
    expect(states.map(s => s.tag)).toEqual(['Submitted', 'Failed']);
    expect(states[1]).toMatchObject({ tag: 'Failed', reason: 'duplicate' });
    pairing.abort();
  });

  it('drops statements that cannot be decrypted (wrong recipient or tampered)', async () => {
    const device = buildDeviceIdentity();
    const store = makeFakeStore();
    const pairing = startPairingV2({ statementStore: store, deviceIdentity: device, metadata: {} });

    // Statement encrypted to a different device
    const otherDevice = buildDeviceIdentity();
    const innerBytes = EncryptedHandshakeResponseV2.enc({
      tag: 'Failed',
      value: 'should be dropped',
    });
    store.emit([buildStatement(otherDevice, innerBytes)]);

    // Should still be in Submitted (no transition)
    const state = await firstValueFrom(pairing.state$);
    expect(state.tag).toBe('Submitted');
    pairing.abort();
  });

  it('abort() is idempotent and tears down cleanly', () => {
    const device = buildDeviceIdentity();
    const store = makeFakeStore();
    const pairing = startPairingV2({ statementStore: store, deviceIdentity: device, metadata: {} });

    expect(() => pairing.abort()).not.toThrow();
    expect(() => pairing.abort()).not.toThrow();
  });
});
