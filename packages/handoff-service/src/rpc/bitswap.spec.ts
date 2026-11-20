import { blake2b } from '@noble/hashes/blake2.js';
import { describe, expect, it } from 'vitest';

import { bitswapBytesMatchHash, hopBitswapCid } from './bitswap.js';

describe('hopBitswapCid', () => {
  // Golden vectors generated independently with `multiformats`:
  // CID.createV1(0x55, createDigest(0xb220, hash)).toString()
  it('renders the CIDv1/raw/blake2b-256 multibase string for a 32-byte hash', () => {
    expect(hopBitswapCid(new Uint8Array(32).fill(0xaa))).toBe(
      'bafk2bzacecvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvku',
    );
    expect(hopBitswapCid(Uint8Array.from(Array.from({ length: 32 }, (_, i) => i)))).toBe(
      'bafk2bzaceaaacaqdaqcqmbyibefawdanbyhraeiscmkbkfqxdamrugy4dupb6',
    );
  });

  it('rejects hashes that are not 32 bytes', () => {
    expect(() => hopBitswapCid(new Uint8Array(31))).toThrow(/32 bytes/);
  });
});

describe('bitswapBytesMatchHash', () => {
  it('accepts bytes whose blake2b-256 digest equals the entry hash', () => {
    const bytes = new TextEncoder().encode('promoted entry');
    expect(bitswapBytesMatchHash(bytes, blake2b(bytes, { dkLen: 32 }))).toBe(true);
  });

  it('rejects substituted bytes', () => {
    const bytes = new TextEncoder().encode('promoted entry');
    const other = new TextEncoder().encode('promoted entrX');
    expect(bitswapBytesMatchHash(other, blake2b(bytes, { dkLen: 32 }))).toBe(false);
  });
});
