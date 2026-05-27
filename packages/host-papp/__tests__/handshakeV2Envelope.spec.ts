import { p256 } from '@noble/curves/nist.js';
import { createEncryption } from '@novasamatech/statement-store';
import { describe, expect, it } from 'vitest';

import { decryptResponseEnvelope } from '../src/sso/auth/v2/envelope.js';

const ecdhX = (priv: Uint8Array, pub: Uint8Array): Uint8Array => p256.getSharedSecret(priv, pub).slice(1, 33);

// Build a HandshakeResponseV2-shaped envelope mirroring the answering peer's
// encrypt path: caller-side ephemeral P-256 keypair, ECDH against the
// device's encryption public key, then `createEncryption(shared).encrypt(...)`.
const wrap = (devicePublicKey: Uint8Array, payload: Uint8Array): { encrypted: Uint8Array; tmpKey: Uint8Array } => {
  const tmpPrivate = p256.utils.randomSecretKey();
  const tmpKey = p256.getPublicKey(tmpPrivate, false);
  const shared = ecdhX(tmpPrivate, devicePublicKey);
  const result = createEncryption(shared).encrypt(payload);
  if (result.isErr()) throw result.error;
  return { encrypted: result.value, tmpKey };
};

describe('decryptResponseEnvelope', () => {
  it('round-trips a payload encrypted with a one-time-use ephemeral key against the device public key', () => {
    const devicePrivate = p256.utils.randomSecretKey();
    const devicePublic = p256.getPublicKey(devicePrivate, false);

    const inner = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const envelope = wrap(devicePublic, inner);

    const decrypted = decryptResponseEnvelope(devicePrivate, envelope);
    expect(decrypted).toEqual(inner);
  });

  it('throws on a tmpKey that was not the actual encryption peer', () => {
    const devicePrivate = p256.utils.randomSecretKey();
    const devicePublic = p256.getPublicKey(devicePrivate, false);

    const envelope = wrap(devicePublic, new Uint8Array([0xff]));
    const wrongTmpPrivate = p256.utils.randomSecretKey();
    const wrongTmpKey = p256.getPublicKey(wrongTmpPrivate, false);

    expect(() =>
      decryptResponseEnvelope(devicePrivate, { encrypted: envelope.encrypted, tmpKey: wrongTmpKey }),
    ).toThrow();
  });

  it('throws on a tampered ciphertext (auth-tag failure)', () => {
    const devicePrivate = p256.utils.randomSecretKey();
    const devicePublic = p256.getPublicKey(devicePrivate, false);

    const envelope = wrap(devicePublic, new Uint8Array([0x42, 0x42, 0x42]));
    const tampered = new Uint8Array(envelope.encrypted);
    const lastIdx = tampered.length - 1;
    tampered[lastIdx] = (tampered[lastIdx] ?? 0) ^ 1; // flip a bit in the auth tag

    expect(() => decryptResponseEnvelope(devicePrivate, { encrypted: tampered, tmpKey: envelope.tmpKey })).toThrow();
  });
});
