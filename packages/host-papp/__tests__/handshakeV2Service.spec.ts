import { x25519 } from '@noble/curves/ed25519.js';
import { createEncryption, createInMemoryStatementStore } from '@novasamatech/statement-store';
import { firstValueFrom, lastValueFrom, take, toArray } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { EncryptedHandshakeResponseV2, VersionedHandshakeResponse } from '../src/sso/auth/scale/handshakeV2.js';
import type { DeviceIdentityForPairing } from '../src/sso/auth/v2/service.js';
import { startPairingV2 } from '../src/sso/auth/v2/service.js';

import { publishPairingResponse } from './peerSession.js';

const ecdh = (priv: Uint8Array, pub: Uint8Array): Uint8Array => x25519.getSharedSecret(priv, pub);

const buildDeviceIdentity = (): DeviceIdentityForPairing => {
  const encryptionPrivateKey = x25519.utils.randomSecretKey();
  return {
    statementAccountPublicKey: new Uint8Array(32).fill(0xa1),
    statementAccountSecret: new Uint8Array(64).fill(0x55),
    encryptionPrivateKey,
    encryptionPublicKey: x25519.getPublicKey(encryptionPrivateKey),
  };
};

const wrapInnerResponse = (
  device: DeviceIdentityForPairing,
  inner: Uint8Array,
): { encrypted: Uint8Array; tmpKey: Uint8Array } => {
  const tmpPrivate = x25519.utils.randomSecretKey();
  const tmpKey = x25519.getPublicKey(tmpPrivate);
  const shared = ecdh(tmpPrivate, device.encryptionPublicKey);
  const result = createEncryption(shared).encrypt(inner);
  if (result.isErr()) throw result.error;
  return { encrypted: result.value, tmpKey };
};

const responseBytes = (device: DeviceIdentityForPairing, innerBytes: Uint8Array): Uint8Array =>
  VersionedHandshakeResponse.enc({ tag: 'V2', value: wrapInnerResponse(device, innerBytes) });

// Publish on `device`'s pairing topic, encrypted to `recipient` — the same
// device, unless the test is checking that foreign statements get dropped.
const makePublisher =
  (store: ReturnType<typeof createInMemoryStatementStore>, device: DeviceIdentityForPairing) =>
  (innerBytes: Uint8Array, recipient = device) =>
    publishPairingResponse(store, device, responseBytes(recipient, innerBytes));

describe('startPairingV2', () => {
  it('exposes a polkadotapp:// pairing deeplink as qrPayload', () => {
    const device = buildDeviceIdentity();
    const store = createInMemoryStatementStore();

    const pairing = startPairingV2({
      statementStore: store,
      deviceIdentity: device,
      metadata: { hostName: 'Polkadot Desktop' },
    });

    expect(pairing.qrPayload).toMatch(/^polkadotapp:\/\/pair\?handshake=[0-9a-f]+$/);
    pairing.abort();
  });

  it('subscribes to the device pairing topic on startup', async () => {
    const device = buildDeviceIdentity();
    const store = createInMemoryStatementStore();

    const pairing = startPairingV2({
      statementStore: store,
      deviceIdentity: device,
      metadata: {},
    });

    expect(store.activeSubscriptions()).toBe(1);

    // Same response, published on another device's pairing topic: an over-broad
    // subscription would pick it up, a correctly scoped one never sees it.
    const onStatementProcessed = vi.fn();
    const elsewhere = buildDeviceIdentity();
    await publishPairingResponse(
      store,
      elsewhere,
      responseBytes(device, EncryptedHandshakeResponseV2.enc({ tag: 'Failed', value: 'wrong topic' })),
    );

    expect(onStatementProcessed).not.toHaveBeenCalled();
    expect((await firstValueFrom(pairing.state$)).tag).toBe('Submitted');
    pairing.abort();
  });

  it('starts in Submitted state', async () => {
    const device = buildDeviceIdentity();
    const store = createInMemoryStatementStore();
    const pairing = startPairingV2({ statementStore: store, deviceIdentity: device, metadata: {} });

    const first = await firstValueFrom(pairing.state$);
    expect(first.tag).toBe('Submitted');
    pairing.abort();
  });

  it('transitions Submitted → Pending → Success on the canonical response sequence', async () => {
    const device = buildDeviceIdentity();
    const store = createInMemoryStatementStore();
    const publish = makePublisher(store, device);
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
    await publish(pendingBytes);

    const successBytes = EncryptedHandshakeResponseV2.enc({
      tag: 'Success',
      value: {
        identityAccountId: new Uint8Array(32).fill(0xa1),
        rootAccountId: new Uint8Array(32).fill(0xa2),
        identityChatPrivateKey: new Uint8Array(32).fill(0xdd),
        ssoEncPubKey: new Uint8Array(32).fill(0x06),
        deviceEncPubKey: new Uint8Array(32).fill(0x04),
        rootEntropySource: new Uint8Array(32).fill(0x07),
      },
    });
    await publish(successBytes);

    const states = await collected;
    expect(states.map(s => s.tag)).toEqual(['Submitted', 'Pending', 'Success']);
    expect(persistOnSuccess).toHaveBeenCalledOnce();
    expect(persistOnSuccess).toHaveBeenCalledWith(expect.objectContaining({ tag: 'Success' }));
    pairing.abort();
  });

  it('transitions to Failed on a Failed inner response', async () => {
    const device = buildDeviceIdentity();
    const store = createInMemoryStatementStore();
    const publish = makePublisher(store, device);
    const pairing = startPairingV2({ statementStore: store, deviceIdentity: device, metadata: {} });

    const states$ = pairing.state$.pipe(take(2), toArray());
    const collected = lastValueFrom(states$);

    const failedBytes = EncryptedHandshakeResponseV2.enc({ tag: 'Failed', value: 'duplicate' });
    await publish(failedBytes);

    const states = await collected;
    expect(states.map(s => s.tag)).toEqual(['Submitted', 'Failed']);
    expect(states[1]).toMatchObject({ tag: 'Failed', reason: 'duplicate' });
    pairing.abort();
  });

  it('drops statements that cannot be decrypted (wrong recipient or tampered)', async () => {
    const device = buildDeviceIdentity();
    const store = createInMemoryStatementStore();
    const publish = makePublisher(store, device);
    // Proves the statement reached the service: without it, "still Submitted"
    // is equally true of a statement that never arrived at all.
    const onStatementProcessed = vi.fn();
    const pairing = startPairingV2({
      statementStore: store,
      deviceIdentity: device,
      metadata: {},
      onStatementProcessed,
    });

    // Statement encrypted to a different device
    const otherDevice = buildDeviceIdentity();
    const innerBytes = EncryptedHandshakeResponseV2.enc({
      tag: 'Failed',
      value: 'should be dropped',
    });
    await publish(innerBytes, otherDevice);

    expect(onStatementProcessed).toHaveBeenCalledOnce();
    expect((await firstValueFrom(pairing.state$)).tag).toBe('Submitted');
    pairing.abort();
  });

  it('abort() is idempotent and tears down cleanly', () => {
    const device = buildDeviceIdentity();
    const store = createInMemoryStatementStore();
    const pairing = startPairingV2({ statementStore: store, deviceIdentity: device, metadata: {} });

    expect(() => pairing.abort()).not.toThrow();
    expect(() => pairing.abort()).not.toThrow();
  });
});
