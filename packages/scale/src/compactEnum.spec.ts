import type { Codec } from 'scale-ts';
import { _void, str, u8 } from 'scale-ts';
import { describe, expect, it } from 'vitest';

import { compact } from './compact.js';
import { CompactEnum } from './compactEnum.js';
import { Enum } from './enum.js';

// Permissive view for tests that build enums dynamically or feed invalid tags.
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

  it('encodes the discriminant with the JAM compact codec', () => {
    // Indices 0..=127 are a single byte equal to the index (identical to a u8),
    // so the payload follows immediately.
    expect([...codec.enc({ tag: 'a', value: undefined })]).toEqual([0]);
    expect([...codec.enc({ tag: 'b', value: 7 })]).toEqual([1, 7]);
    expect([...codec.enc({ tag: 'c', value: 'hi' })]).toEqual([2, ...str.enc('hi')]);

    // Index >= 128 is where compact diverges from a u8: 128 -> [128, 128].
    const fields: Record<string, typeof _void> = {};
    for (let i = 0; i <= 128; i++) fields[`v${i}`] = _void;
    const wide = CompactEnum(fields) as unknown as AnyEnumCodec;
    expect([...wide.enc({ tag: 'v128', value: undefined })]).toEqual([128, 128]);
  });

  it('is wire-identical to a u8 Enum for indices 0..=127', () => {
    const fields: Record<string, typeof u8> = {};
    for (let i = 0; i < 128; i++) fields[`v${i}`] = u8;
    const compactCodec = CompactEnum(fields) as unknown as AnyEnumCodec;
    const u8Codec = Enum(fields) as unknown as AnyEnumCodec;

    for (const tag of ['v0', 'v1', 'v76', 'v127']) {
      const value = { tag, value: 9 };
      expect([...compactCodec.enc(value)]).toEqual([...u8Codec.enc(value)]);
    }
  });

  it('diverges from a u8 Enum for indices >= 128', () => {
    const fields: Record<string, typeof u8> = {};
    for (let i = 0; i <= 200; i++) fields[`v${i}`] = u8;
    const compactCodec = CompactEnum(fields) as unknown as AnyEnumCodec;
    const u8Codec = Enum(fields) as unknown as AnyEnumCodec;

    const value = { tag: 'v200', value: 9 };
    // u8 Enum: single-byte discriminant. CompactEnum: 2-byte compact discriminant.
    expect([...u8Codec.enc(value)]).toEqual([200, 9]);
    expect([...compactCodec.enc(value)]).toEqual([...compact.enc(200), 9]);
    expect([...compactCodec.enc(value)]).not.toEqual([...u8Codec.enc(value)]);
  });

  it('supports more than 256 variants (the reason it exists)', () => {
    const fields: Record<string, typeof _void> = {};
    for (let i = 0; i < 300; i++) fields[`v${i}`] = _void;
    const big = CompactEnum(fields) as unknown as AnyEnumCodec;

    // index 299 is unrepresentable as a u8; it must still round-trip.
    const encoded = big.enc({ tag: 'v299', value: undefined });
    expect(big.dec(encoded)).toEqual({ tag: 'v299', value: undefined });
  });

  it('throws on an unknown variant tag', () => {
    expect(() => (codec as unknown as AnyEnumCodec).enc({ tag: 'nope', value: undefined })).toThrow(
      /unknown variant tag/,
    );
  });
});
