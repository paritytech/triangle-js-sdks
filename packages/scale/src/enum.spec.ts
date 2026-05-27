import { bool, u8 } from 'scale-ts';
import { describe, expect, it } from 'vitest';

import { Enum } from './enum.js';

describe('Enum', () => {
  it('should correctly encode/decode Enum', () => {
    const codec = Enum({
      a: u8,
      b: bool,
    });

    expect(codec.enc({ tag: 'a', value: 1 })).toEqual(new Uint8Array([0, 1]));
    expect(codec.enc({ tag: 'b', value: true })).toEqual(new Uint8Array([1, 1]));

    expect(codec.dec(new Uint8Array([0, 1]))).toEqual({ tag: 'a', value: 1 });
    expect(codec.dec(new Uint8Array([1, 1]))).toEqual({ tag: 'b', value: true });
  });

  it('accepts up to 256 variants but rejects more (u8 discriminant limit)', () => {
    const fields = (count: number): Record<string, typeof u8> => {
      const out: Record<string, typeof u8> = {};
      for (let i = 0; i < count; i++) out[`v${i}`] = u8;
      return out;
    };

    expect(() => Enum(fields(256))).not.toThrow();
    expect(() => Enum(fields(257))).toThrow(/exceed the 256/);
  });
});
