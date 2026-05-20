/**
 * Decrypt the outer envelope of a `HandshakeResponseV2` statement payload.
 *
 * The answering side generates a one-shot P-256 keypair, performs ECDH against
 * the host device's encryption public key, and AES-GCM encrypts the sensitive
 * payload (the SCALE-encoded `EncryptedHandshakeResponseV2`) with a key
 * derived from the shared secret.
 *
 * The shared-secret-to-AES-key derivation (HKDF-SHA256 over the ECDH X
 * coordinate) is delegated to `createEncryption(sharedSecret)` from
 * `@novasamatech/statement-store` — byte-compatible with the existing V1
 * chat-request encryption helper, so we don't fork primitives here.
 */

import { p256 } from '@noble/curves/nist.js';
import { createEncryption } from '@novasamatech/statement-store';

export type HandshakeResponseEnvelope = {
  encrypted: Uint8Array;
  tmpKey: Uint8Array;
};

const ecdhX = (privateKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array =>
  p256.getSharedSecret(privateKey, peerPublicKey).slice(1, 33);

export const decryptResponseEnvelope = (
  deviceEncryptionPrivateKey: Uint8Array,
  envelope: HandshakeResponseEnvelope,
): Uint8Array => {
  const shared = ecdhX(deviceEncryptionPrivateKey, envelope.tmpKey);
  const result = createEncryption(shared).decrypt(envelope.encrypted);
  if (result.isErr()) throw result.error;
  return result.value;
};
