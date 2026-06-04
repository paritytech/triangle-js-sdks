import { blake2b } from '@noble/hashes/blake2.js';

const textEncoder = new TextEncoder();
const DOMAIN_SEPARATOR = textEncoder.encode('product-entropy-derivation');

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
 * Layer 1 derives the `rootEntropySource` from the raw root account secret.
 * Hosts that never hold the raw secret but receive `rootEntropySource` over the
 * SSO handshake (RFC-0007 "Option 1") should call
 * {@link deriveProductEntropyFromSource} instead — it skips layer 1 and yields
 * identical output.
 *
 * @param rootAccountSecret - Raw BIP-39 entropy bytes of the root account
 * @param productId         - Identifier of the calling product (arbitrary-length string)
 * @param key               - Caller-chosen key, 1 to 32 bytes
 */
export function deriveProductEntropy(rootAccountSecret: Uint8Array, productId: string, key: Uint8Array): Uint8Array {
  const rootEntropySource = blake2b256Keyed(rootAccountSecret, DOMAIN_SEPARATOR);
  return deriveProductEntropyFromSource(rootEntropySource, productId, key);
}

/**
 * Derives 32 bytes of deterministic entropy from a precomputed
 * `rootEntropySource` — layers 2 and 3 of the RFC-0007 scheme.
 *
 * Use this when the host never holds the raw `rootAccountSecret` but receives
 * `rootEntropySource = blake2b256_keyed(rootAccountSecret, "product-entropy-derivation")`
 * over the SSO handshake (RFC-0007 "Option 1"). Given the same `rootEntropySource`,
 * `productId`, and `key`, the output is byte-for-byte identical to
 * {@link deriveProductEntropy} called with the corresponding `rootAccountSecret`.
 *
 * Do NOT pass a `rootEntropySource` to {@link deriveProductEntropy}: that would
 * re-apply layer 1 and produce a different, non-conforming result.
 *
 * @param rootEntropySource - 32-byte source derived from the root account secret
 * @param productId         - Identifier of the calling product (arbitrary-length string)
 * @param key               - Caller-chosen key, 1 to 32 bytes
 */
export function deriveProductEntropyFromSource(
  rootEntropySource: Uint8Array,
  productId: string,
  key: Uint8Array,
): Uint8Array {
  if (key.length === 0 || key.length > 32) {
    throw new Error(`"key" must be between 1 and 32 bytes, got ${key.length}`);
  }

  const perProductEntropy = blake2b256Keyed(rootEntropySource, blake2b256(textEncoder.encode(productId)));

  return blake2b256Keyed(perProductEntropy, key);
}
