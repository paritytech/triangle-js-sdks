import { u8 } from 'scale-ts';
import { describe, expect, it } from 'vitest';

import { compact } from './compact.js';

describe('compact', () => {
  // Reference vectors, cross-checked against jam-codec's `Compact`.
  const vectors: [number, number[]][] = [
    [0, [0]],
    [1, [1]],
    [63, [63]],
    [64, [64]],
    [127, [127]],
    [128, [128, 128]],
    [255, [128, 255]],
    [256, [129, 0]],
    [16383, [191, 255]],
    [16384, [192, 0, 64]],
  ];

  it('matches the JAM compact byte vectors', () => {
    for (const [value, bytes] of vectors) {
      expect([...compact.enc(value)]).toEqual(bytes);
    }
  });

  it('round-trips', () => {
    for (const value of [0, 1, 127, 128, 255, 256, 1000, 65535, 70000, 1_000_000]) {
      expect(compact.dec(compact.enc(value))).toBe(value);
    }
  });

  it('is byte-identical to a u8 for values 0..=127', () => {
    for (let value = 0; value <= 127; value++) {
      expect([...compact.enc(value)]).toEqual([...u8.enc(value)]);
    }
  });

  it('rejects values outside the non-negative safe-integer range', () => {
    expect(() => compact.enc(-1)).toThrow();
    expect(() => compact.enc(1.5)).toThrow();
    expect(() => compact.enc(Number.MAX_SAFE_INTEGER + 1)).toThrow(/safe integer/);
    // An oversized (0xff-prefixed) wire value is rejected, not silently rounded.
    expect(() => compact.dec(new Uint8Array([0xff, 1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/safe integer/);
  });
});
