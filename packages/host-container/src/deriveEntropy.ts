import { blake2b } from '@noble/hashes/blake2.js';

function blake2b256Keyed(message: Uint8Array, key: Uint8Array): Uint8Array {
  return blake2b(message, { dkLen: 32, key });
}

function blake2b256(message: Uint8Array): Uint8Array {
  return blake2b(message, { dkLen: 32 });
}

/**
 * Derives 32 bytes of deterministic entropy using the three-layer
 * BLAKE2b-256 scheme specified in RFC-0007.
 *
 * @param rootAccountSecret - Raw BIP-39 entropy bytes of the root account
 * @param productId         - Identifier of the calling product (arbitrary-length string)
 * @param key               - Caller-chosen key, up to 32 bytes
 */
export function deriveProductEntropy(rootAccountSecret: Uint8Array, productId: string, key: Uint8Array): Uint8Array {
  if (key.length === 0 || key.length > 32) {
    throw new Error(`"key" must be between 1 and 32 bytes, got ${key.length}`);
  }

  const textEncoder = new TextEncoder();

  const rootEntropySource = blake2b256Keyed(rootAccountSecret, textEncoder.encode('product-entropy-derivation'));
  const perProductEntropy = blake2b256Keyed(rootEntropySource, blake2b256(textEncoder.encode(productId)));

  return blake2b256Keyed(perProductEntropy, key);
}
