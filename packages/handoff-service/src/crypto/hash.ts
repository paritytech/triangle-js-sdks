import { blake2b } from '@noble/hashes/blake2.js';

/**
 * The HOP entry hash: blake2b-256 over the *encrypted* entry bytes. It keys the
 * pool, is the digest inside the bitswap CID once the entry is promoted
 * on-chain, and is what the root entry's `identifier` and every chunk hash are.
 */
export function blake2b256(data: Uint8Array): Uint8Array {
  return blake2b(data, { dkLen: 32 });
}
