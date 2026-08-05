import { describe, expect, it } from 'vitest';

import { Bytes } from './bytes.js';

describe('Bytes', () => {
  it('should expose the fixed size', () => {
    expect(Bytes(32).size).toBe(32);
    expect(Bytes().size).toBeUndefined();
  });

  it('should encode/decode with a length prefix when size is not fixed', () => {
    const codec = Bytes();
    const value = new Uint8Array([1, 2, 3]);

    expect(codec.enc(value)).toEqual(new Uint8Array([12, 1, 2, 3]));
    expect(codec.dec(codec.enc(value))).toEqual(value);
  });

  it('should encode/decode a value of exactly the fixed size', () => {
    const codec = Bytes(3);
    const value = new Uint8Array([1, 2, 3]);

    expect(codec.enc(value)).toEqual(value);
    expect(codec.dec(codec.enc(value))).toEqual(value);
  });

  it('should zero-pad a shorter value up to the fixed size', () => {
    const codec = Bytes(4);

    expect(codec.enc(new Uint8Array([1, 2]))).toEqual(new Uint8Array([1, 2, 0, 0]));
  });

  it('should throw on a value longer than the fixed size', () => {
    const codec = Bytes(2);

    expect(() => codec.enc(new Uint8Array([1, 2, 3]))).toThrow(/too long/);
  });

  // scale-ts hands back whatever the stream had left, which reads as a legitimate value.
  it('should throw when fewer than the fixed size bytes are available to decode', () => {
    const codec = Bytes(4);

    expect(() => codec.dec(new Uint8Array([1, 2]))).toThrow(/expected 4/);
  });
});
