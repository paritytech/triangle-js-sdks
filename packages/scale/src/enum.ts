import type { Codec, StringRecord } from 'scale-ts';
import { Enum as ScaleEnum } from 'scale-ts';

type FilterStringRecord<T extends Record<string, Codec<any>>> = T extends StringRecord<Codec<any>> ? T : never;

// A u8 discriminant addresses indices 0..=255, i.e. at most 256 variants.
// This matches jam-codec, which rejects enums with more than 256 variants.
const MAX_VARIANTS = 256;

export type EnumCodec<T extends Record<string, Codec<any>>> = ReturnType<typeof Enum<T>>;

/**
 * Tagged-union codec with a single-byte (`u8`) discriminant, matching jam-codec's
 * enum encoding. Capped at 256 variants; use {@link CompactEnum} when more are
 * needed (at the cost of jam-codec wire compatibility for indices >= 128).
 */
export const Enum = <T extends Record<string, Codec<any>>>(inner: T) => {
  const variants = Object.keys(inner).length;
  if (variants > MAX_VARIANTS) {
    throw new Error(
      `Enum: ${variants} variants exceed the ${MAX_VARIANTS} a u8 discriminant can address; use CompactEnum`,
    );
  }
  return ScaleEnum(inner as FilterStringRecord<T>);
};
