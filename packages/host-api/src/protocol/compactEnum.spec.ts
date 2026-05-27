import type { Codec } from 'scale-ts';
import { _void, compact, str, u8 } from 'scale-ts';
import { describe, expect, it } from 'vitest';

import { CompactEnum } from './compactEnum.js';

// Permissive view for tests that build enums dynamically or feed invalid tags,
// where the precise per-variant types are not available.
type AnyEnumCodec = Codec<{ tag: string; value: unknown }>;

describe('CompactEnum', () => {
  const codec = CompactEnum({
    a: _void, // index 0
    b: u8, // index 1
    c: str, // index 2
  });

  it('round-trips every variant', () => {
    for (const value of [
      { tag: 'a', value: undefined },
      { tag: 'b', value: 42 },
      { tag: 'c', value: 'hello' },
    ] as const) {
      expect(codec.dec(codec.enc(value))).toEqual(value);
    }
  });

  it('encodes the discriminant as a compact integer (not a raw u8)', () => {
    // index 0 -> [0] (compact and u8 agree only here)
    expect([...codec.enc({ tag: 'a', value: undefined })]).toEqual([0]);
    // index 1 -> compact [4], i.e. 1 << 2 (a raw u8 would be [1])
    expect([...codec.enc({ tag: 'b', value: 7 })]).toEqual([4, 7]);
    // index 2 -> compact [8]; payload "hi" = compact len(2)=[8] + bytes
    expect([...codec.enc({ tag: 'c', value: 'hi' })]).toEqual([8, ...str.enc('hi')]);
  });

  it('supports more than 256 variants (the reason for the compact discriminant)', () => {
    const fields: Record<string, typeof _void> = {};
    for (let i = 0; i < 300; i++) fields[`v${i}`] = _void;
    const big = CompactEnum(fields) as unknown as AnyEnumCodec;

    // index 299 is unrepresentable as a u8; it must still round-trip here.
    const encoded = big.enc({ tag: 'v299', value: undefined });
    expect([...encoded]).toEqual([...compact.enc(299)]);
    expect(big.dec(encoded)).toEqual({ tag: 'v299', value: undefined });
  });

  it('throws on an unknown variant tag', () => {
    expect(() => (codec as unknown as AnyEnumCodec).enc({ tag: 'nope', value: undefined })).toThrow(
      /unknown variant tag/,
    );
  });
});
