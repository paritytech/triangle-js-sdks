import type { Codec } from 'scale-ts';
import { createCodec, createDecoder, u8 } from 'scale-ts';

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
 * General natural-number ("compact") encoding as used by JAM (see the JAM
 * graypaper and the `Compact` type in jam-codec).
 *
 * Unlike parity-SCALE compact (which encodes `value << 2`), values 0..=127
 * encode as a single byte equal to the value. This makes it a drop-in,
 * wire-compatible widening of a `u8`: anything that fit in one byte still does,
 * and larger values spill into additional bytes.
 *
 * Encoding of `x`:
 *   - `x === 0`            -> `[0]`
 *   - `2^(7l) <= x < 2^(7(l+1))` for some `l` in 0..8:
 *       first byte `256 - 2^(8-l) + floor(x / 2^(8l))`, then `x mod 2^(8l)`
 *       as `l` little-endian bytes
 *   - otherwise (`x >= 2^56`): `[0xff]` followed by `x` as 8 little-endian bytes
 *
 * Values are JS numbers, so this is exact up to `Number.MAX_SAFE_INTEGER`
 * (2^53), far beyond the enum-discriminant use case it exists for.
 */
const enc = (value: number): Uint8Array => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`compact: expected a non-negative integer, got ${value}`);
  }
  if (value === 0) return new Uint8Array([0]);

  for (let l = 0; l < 8; l++) {
    if (value >= 2 ** (7 * l) && value < 2 ** (7 * (l + 1))) {
      const out = new Uint8Array(1 + l);
      out[0] = 256 - 2 ** (8 - l) + Math.floor(value / 2 ** (8 * l));
      let rem = value % 2 ** (8 * l);
      for (let i = 0; i < l; i++) {
        out[1 + i] = rem % 256;
        rem = Math.floor(rem / 256);
      }
      return out;
    }
  }

  const out = new Uint8Array(9);
  out[0] = 0xff;
  let rem = value;
  for (let i = 0; i < 8; i++) {
    out[1 + i] = rem % 256;
    rem = Math.floor(rem / 256);
  }
  return out;
};

const dec = createDecoder(bytes => {
  const first = u8.dec(bytes);
  if (first === 0) return 0;

  if (first === 0xff) {
    let value = 0;
    for (let i = 0; i < 8; i++) value += u8.dec(bytes) * 2 ** (8 * i);
    return value;
  }

  // `l` = count of leading 1-bits before the first 0-bit (from the MSB).
  let l = 0;
  while (l < 8 && (first & (0b1000_0000 >> l)) !== 0) l++;

  let value = 0;
  for (let i = 0; i < l; i++) value += u8.dec(bytes) * 2 ** (8 * i);
  const rem = first & ((1 << (7 - l)) - 1);
  return value + rem * 2 ** (8 * l);
});

export const compact: Codec<number> = createCodec(enc, dec);

export { concatBytes };
