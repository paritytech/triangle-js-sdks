import type { Codec, CodecType, StringRecord } from 'scale-ts';
import { createCodec, createDecoder } from 'scale-ts';

import { compact, concatBytes } from './compact.js';

type FilterStringRecord<T extends Record<string, Codec<any>>> = T extends StringRecord<Codec<any>> ? T : never;

export type CompactEnumCodec<T extends Record<string, Codec<any>>> = Codec<
  (FilterStringRecord<T> extends infer F extends StringRecord<Codec<any>>
    ? { [K in keyof F]: { tag: K; value: CodecType<F[K]> } }
    : never)[keyof FilterStringRecord<T>]
>;

/**
 * Tagged-union codec like {@link Enum}, but the variant discriminant is encoded
 * with the JAM-style {@link compact} codec instead of a single `u8`. This lifts
 * the 256-variant cap a `u8` discriminant imposes.
 *
 * Trade-off vs `Enum` / jam-codec: compact is byte-identical to a `u8` only for
 * indices 0..=127. For index >= 128 the encoding differs (e.g. index 128 ->
 * `[128, 128]` here vs `[128]` for a u8), so a CompactEnum is NOT wire-compatible
 * with a jam-codec enum past index 127. Use it only where >256 variants are
 * actually needed and the wire format is owned by this codebase.
 *
 * Variants are indexed by their position in `inner` (insertion order).
 */
export const CompactEnum = <T extends Record<string, Codec<any>>>(inner: T): CompactEnumCodec<T> => {
  const tags = Object.keys(inner);
  const indexByTag = new Map(tags.map((tag, index) => [tag, index] as const));

  const enc = ({ tag, value }: { tag: string; value: unknown }): Uint8Array => {
    const index = indexByTag.get(tag);
    const codec = inner[tag];
    if (index === undefined || codec === undefined) {
      throw new Error(`CompactEnum: cannot encode unknown variant tag "${tag}"`);
    }
    return concatBytes([compact.enc(index), codec.enc(value)]);
  };

  const dec = createDecoder(bytes => {
    const index = compact.dec(bytes);
    const tag = tags[index];
    const codec = tag === undefined ? undefined : inner[tag];
    if (tag === undefined || codec === undefined) {
      throw new Error(`CompactEnum: cannot decode unknown variant index ${index}`);
    }
    return { tag, value: codec.dec(bytes) };
  });

  return createCodec(enc, dec) as unknown as CompactEnumCodec<T>;
};
