import { describe, expect, it } from 'vitest';

import { OptionBool } from './optionBool.js';

describe('OptionBool', () => {
  it('should correctly encode/decode OptionBool', () => {
    expect(OptionBool.enc(undefined)).toEqual(new Uint8Array([0]));
    expect(OptionBool.enc(true)).toEqual(new Uint8Array([1]));
    expect(OptionBool.enc(false)).toEqual(new Uint8Array([2]));

    expect(OptionBool.dec(new Uint8Array([0]))).toEqual(undefined);
    expect(OptionBool.dec(new Uint8Array([1]))).toEqual(true);
    expect(OptionBool.dec(new Uint8Array([2]))).toEqual(false);
  });

  it('should throw in bytes has incorrect value', () => {
    expect(() => OptionBool.dec(new Uint8Array([3]))).toThrowErrorMatchingInlineSnapshot(
      `[Error: Unknown value for optionBool: 3. Should be ether 0, 1 or 2.]`,
    );
  });
});
