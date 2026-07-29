import { blake2b } from '@noble/hashes/blake2.js';
import type { CodecType, DerivationIndex } from '@novasamatech/host-api';
import { RawDerivationIndex } from '@novasamatech/host-api';

const textEncoder = new TextEncoder();

/** Length of the magic tail separating plain-index space from raw indexes. */
const INDEX_MAGIC_LENGTH = 28;

/**
 * 28-byte magic separating the plain-index space from raw 32-byte indexes
 * (RFC-0022): `blake2b256("product-account-index")[..28]`.
 *
 * A raw index only collides with a plain index if it ends in this magic.
 */
export const INDEX_MAGIC: Uint8Array = blake2b(textEncoder.encode('product-account-index'), { dkLen: 32 }).slice(
  0,
  INDEX_MAGIC_LENGTH,
);

/**
 * Expands a plain `u32` index into the internal 32-byte derivation index
 * (RFC-0022): the index little-endian followed by {@link INDEX_MAGIC}.
 *
 * The result is used directly as the chain code of the soft `/{index}` junction
 * in `//product//{productId}/{index}` — no substrate path-segment parsing or
 * normalization is involved.
 */
export function indexBytes(index: number): Uint8Array {
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) {
    throw new Error(`"index" must be a u32, got ${index}`);
  }

  const bytes = new Uint8Array(RawDerivationIndex.size);
  new DataView(bytes.buffer).setUint32(0, index, true);
  bytes.set(INDEX_MAGIC, 4);

  return bytes;
}

/**
 * Maps a wire-level account selector to the internal 32-byte derivation index:
 * `Index(n)` expands via {@link indexBytes}, `Raw(bytes)` passes through
 * unchanged. Past the host API boundary only the 32-byte form exists.
 */
export function derivationIndexBytes(index: CodecType<typeof DerivationIndex>): Uint8Array {
  if (index.tag === 'Index') {
    return indexBytes(index.value);
  }

  if (index.value.length !== RawDerivationIndex.size) {
    throw new Error(`Raw derivation index must be ${RawDerivationIndex.size} bytes, got ${index.value.length}`);
  }

  return index.value;
}
