import { blake2b } from '@noble/hashes/blake2.js';
import { describe, expect, it } from 'vitest';

import { DERIVATION_INDEX_LENGTH, INDEX_MAGIC, derivationIndexBytes, indexBytes } from './derivationIndex.js';

describe('RFC-0022 derivation index', () => {
  it('pins the index magic to blake2b256("product-account-index")[..28]', () => {
    expect(INDEX_MAGIC).toEqual(blake2b(new TextEncoder().encode('product-account-index'), { dkLen: 32 }).slice(0, 28));
    expect(INDEX_MAGIC).toHaveLength(28);
  });

  it('lays out a plain index as u32 little-endian followed by the magic', () => {
    const index = indexBytes(5);

    expect(index).toHaveLength(DERIVATION_INDEX_LENGTH);
    expect(index.slice(0, 4)).toEqual(new Uint8Array([5, 0, 0, 0]));
    expect(index.slice(4)).toEqual(INDEX_MAGIC);
  });

  it('keeps the raw index space disjoint from plain indexes', () => {
    expect(indexBytes(0)).not.toEqual(new Uint8Array(32));
  });

  it('rejects indexes outside u32', () => {
    expect(() => indexBytes(-1)).toThrow();
    expect(() => indexBytes(0x1_0000_0000)).toThrow();
    expect(() => indexBytes(1.5)).toThrow();
  });

  it('maps both selector forms', () => {
    expect(derivationIndexBytes({ tag: 'Left', value: 7 })).toEqual(indexBytes(7));

    const raw = new Uint8Array(32).fill(0xee);
    expect(derivationIndexBytes({ tag: 'Right', value: raw })).toBe(raw);
  });

  it('rejects raw indexes of the wrong length', () => {
    expect(() => derivationIndexBytes({ tag: 'Right', value: new Uint8Array(31) })).toThrow();
  });
});
