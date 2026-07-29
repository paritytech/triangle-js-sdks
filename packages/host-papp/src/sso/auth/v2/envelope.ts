/**
 * Decrypt the outer envelope of a `HandshakeResponseV2` statement payload.
 *
 * The answering side generates a one-shot X25519 keypair, performs ECDH against
 * the host device's encryption public key, and ChaCha20-Poly1305 encrypts the
 * sensitive payload (the SCALE-encoded `EncryptedHandshakeResponseV2`) with a
 * key derived from the shared secret.
 *
 * The shared-secret-to-AEAD-key derivation (HKDF-SHA256 over the X25519 shared
 * secret) is delegated to `createEncryption(sharedSecret)` from
 * `@novasamatech/statement-store` — byte-compatible with the existing V1
 * chat-request encryption helper, so we don't fork primitives here.
 */

import { x25519 } from '@noble/curves/ed25519.js';
import { createEncryption } from '@novasamatech/statement-store';

export type HandshakeResponseEnvelope = {
  encrypted: Uint8Array;
  tmpKey: Uint8Array;
};

const ecdh = (privateKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array =>
  x25519.getSharedSecret(privateKey, peerPublicKey);

export const decryptResponseEnvelope = (
  deviceEncryptionPrivateKey: Uint8Array,
  envelope: HandshakeResponseEnvelope,
): Uint8Array => {
  const shared = ecdh(deviceEncryptionPrivateKey, envelope.tmpKey);
  const result = createEncryption(shared).decrypt(envelope.encrypted);
  if (result.isErr()) throw result.error;
  return result.value;
};
