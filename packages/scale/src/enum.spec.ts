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
});
