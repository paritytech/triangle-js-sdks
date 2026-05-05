import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { mergeUint8 } from '@polkadot-api/utils';

export type FileEncryption = {
  encrypt(data: Uint8Array): Uint8Array;
  decrypt(data: Uint8Array): Uint8Array;
};

/**
 * AES-256-GCM encryption for file chunks and metadata.
 * Format: nonce (12 bytes) || ciphertext || tag (16 bytes)
 */
export function createFileEncryption(key: Uint8Array): FileEncryption {
  return {
    encrypt(data: Uint8Array): Uint8Array {
      const nonce = randomBytes(12);
      const aes = gcm(key, nonce);
      return mergeUint8([nonce, aes.encrypt(data)]);
    },

    decrypt(encryptedData: Uint8Array): Uint8Array {
      const nonce = encryptedData.slice(0, 12);
      const ciphertext = encryptedData.slice(12);
      const aes = gcm(key, nonce);
      return aes.decrypt(ciphertext);
    },
  };
}
