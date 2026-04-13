import { gcm } from '@noble/ciphers/aes.js';
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
  const salt = new Uint8Array(); // secure enough since P256 random keys provide enough entropy
  const info = new Uint8Array(); // no need to introduce any context
  const aesKey = hkdf(sha256, sharedSecret, salt, info, 32);

  return {
    encrypt: fromThrowable(cipherText => {
      const nonce = randomBytes(12);
      const aes = gcm(aesKey, nonce);
      return mergeUint8([nonce, aes.encrypt(cipherText)]);
    }),

    decrypt: fromThrowable(encryptedMessage => {
      const nonce = encryptedMessage.slice(0, 12);
      const cipherText = encryptedMessage.slice(12);

      const aes = gcm(aesKey, nonce);
      return aes.decrypt(cipherText);
    }),
  };
}
