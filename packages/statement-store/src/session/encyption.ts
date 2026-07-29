import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { Result, fromThrowable } from 'neverthrow';
import { mergeUint8 } from 'polkadot-api/utils';

export type Encryption = {
  encrypt(cipherText: Uint8Array): Result<Uint8Array, Error>;
  decrypt(encryptedMessage: Uint8Array): Result<Uint8Array, Error>;
};

export function createEncryption(sharedSecret: Uint8Array): Encryption {
  const salt = new Uint8Array(); // secure enough since the X25519 shared secret provides full entropy
  const info = new Uint8Array(); // no need to introduce any context
  const aeadKey = hkdf(sha256, sharedSecret, salt, info, 32);

  return {
    encrypt: fromThrowable(cipherText => {
      const nonce = randomBytes(12);
      const aead = chacha20poly1305(aeadKey, nonce);
      return mergeUint8([nonce, aead.encrypt(cipherText)]);
    }),

    decrypt: fromThrowable(encryptedMessage => {
      const nonce = encryptedMessage.slice(0, 12);
      const cipherText = encryptedMessage.slice(12);

      const aead = chacha20poly1305(aeadKey, nonce);
      return aead.decrypt(cipherText);
    }),
  };
}
