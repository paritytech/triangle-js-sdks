import type { EnumCodec } from '@novasamatech/scale';
import type { Codec, Decoder, Encoder } from 'scale-ts';
import { compact, createCodec, createDecoder } from 'scale-ts';

type EnumValue = { tag: string; value: unknown };

const concatBytes = (chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((len, chunk) => len + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

/**
 * Drop-in replacement for `@novasamatech/scale`'s `Enum`, but the variant
 * discriminant is encoded as a SCALE-compact integer instead of a single byte.
 *
 * scale-ts `Enum` writes the variant index as a `u8`, capping an enum at 256
 * variants. Encoding the index as `compact` lifts that cap (indices up to the
 * u16 range and beyond) while keeping single-byte tags for indices 0..=63.
 *
 * NOTE: this is NOT wire-compatible with the `u8` form. Under compact, index 0
 * still encodes as `[0]`, but every other index differs (e.g. 1 -> `[4]`,
 * 76 -> `[49, 1]`), so both ends of the protocol must use this codec.
 *
 * Variants are indexed by their position in `inner` (insertion order), matching
 * scale-ts `Enum`.
 */
export const CompactEnum = <const T extends Record<string, Codec<any>>>(inner: T): EnumCodec<T> => {
  const tags = Object.keys(inner);
  const indexByTag = new Map(tags.map((tag, index) => [tag, index] as const));

  const enc: Encoder<EnumValue> = ({ tag, value }) => {
    const index = indexByTag.get(tag);
    const codec = inner[tag];
    if (index === undefined || codec === undefined) {
      throw new Error(`CompactEnum: cannot encode unknown variant tag "${tag}"`);
    }
    return concatBytes([compact.enc(index), codec.enc(value)]);
  };

  const dec: Decoder<EnumValue> = createDecoder(cursor => {
    const index = Number(compact.dec(cursor));
    const tag = tags[index];
    const codec = tag === undefined ? undefined : inner[tag];
    if (tag === undefined || codec === undefined) {
      throw new Error(`CompactEnum: cannot decode unknown variant index ${index}`);
    }
    return { tag, value: codec.dec(cursor) };
  });

  return createCodec(enc, dec) as unknown as EnumCodec<T>;
};
