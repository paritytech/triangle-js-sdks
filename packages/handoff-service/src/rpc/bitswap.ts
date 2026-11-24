import { equalBytes } from '@noble/ciphers/utils.js';
import { mergeUint8 } from '@polkadot-api/utils';

import { blake2b256 } from '../crypto/index.js';

/**
 * On-chain fallback support (chat RFC 0001).
 *
 * Shortly before an unacknowledged HOP entry expires it is promoted to
 * permanent on-chain storage, indexed by the same blake2b-256 hash the pool
 * used as the entry key. The node serves those bytes via `bitswap_v1_get`,
 * addressed by a CID whose digest is, byte for byte, the entry hash.
 */

/** JSON-RPC error codes returned by `bitswap_v1_get` (RFC 0001). */
export const BitswapErrorCode = {
  /** MUST NOT retry — the CID was malformed, i.e. a client-side bug. */
  invalidCid: -32602,
  /** Not on this node (yet) — retry per the RFC retry policy. */
  notFound: -32810,
  /** MajorSyncing / Internal — retry with backoff, or try another node. */
  internal: -32812,
} as const;

// CIDv1 header for a HOP entry hash: version 1, codec 0x55 (raw),
// multihash blake2b-256 (varint 0xb220 -> a0 e4 02), digest length 32.
const CID_PREFIX = Uint8Array.from([0x01, 0x55, 0xa0, 0xe4, 0x02, 0x20]);

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** RFC 4648 base32, lowercase, no padding — multibase `base32` body. */
function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let buffer = 0;
  let out = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(buffer >> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(buffer << (5 - bits)) & 0x1f];
  }
  return out;
}

/**
 * Render the CID for a 32-byte HOP entry hash (root identifier or chunk
 * hash) in multibase base32-lower, as `bitswap_v1_get` expects.
 */
export function hopBitswapCid(entryHash: Uint8Array): string {
  if (entryHash.length !== 32) {
    throw new Error(`HOP entry hash must be 32 bytes, got ${entryHash.length}`);
  }
  return `b${base32Encode(mergeUint8([CID_PREFIX, entryHash]))}`;
}

/**
 * MUST-check from the RFC: the RPC path has no built-in integrity check, so
 * fetched bytes are only usable if they hash back to the entry hash.
 */
export function bitswapBytesMatchHash(bytes: Uint8Array, entryHash: Uint8Array): boolean {
  return equalBytes(blake2b256(bytes), entryHash);
}
