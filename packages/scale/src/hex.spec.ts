import { describe, expect, it } from 'vitest';

import { Hex } from './hex.js';

describe('Hex', () => {
  it('should correctly encode/decode Hex with arbitrary length', () => {
    const hex = '0xffffff';
    const codec = Hex();

    expect(codec.enc(hex)).toEqual(new Uint8Array([12, 255, 255, 255]));
    expect(codec.dec(codec.enc(hex))).toEqual(hex);
  });
  it('should correctly encode/decode Hex with fixed length', () => {
    const hex = '0xffffff';
    const codec = Hex(3);

    expect(codec.enc(hex)).toEqual(new Uint8Array([255, 255, 255]));
    expect(codec.dec(codec.enc(hex))).toEqual(hex);
  });
});
