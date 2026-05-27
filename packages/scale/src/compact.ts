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
 * graypaper and the `Compact` type in jam-codec). This mirrors the reference
 * `WrappedPrimitive` encode/decode in jam-codec:
 * https://github.com/paritytech/jam-codec/blob/8188024a7256583e841c066bbd4019222e6f796d/src/compact.rs#L269-L309
 *
 * Unlike parity-SCALE compact (which encodes `value << 2`), values 0..=127
 * encode as a single byte equal to the value. This makes it a drop-in,
 * wire-compatible widening of a `u8`: anything that fit in one byte still does,
 * and larger values spill into additional bytes.
 *
 * Encoding of `x` (for `0 <= x <= Number.MAX_SAFE_INTEGER`):
 *   - `x === 0` -> `[0]`
 *   - `2^(7l) <= x < 2^(7(l+1))` for some `l` in 0..8:
 *       first byte `256 - 2^(8-l) + floor(x / 2^(8l))`, then `x mod 2^(8l)`
 *       as `l` little-endian bytes
 *
 * Only non-negative safe integers are supported. JAM's 9-byte (`0xff`-prefixed)
 * form encodes values `>= 2^56`, which a JS number cannot represent exactly, so
 * both enc and dec reject anything outside the safe-integer range rather than
 * silently rounding it. That range covers every enum discriminant by far.
 */
const enc = (value: number): Uint8Array => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`compact: expected a non-negative safe integer, got ${value}`);
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

  // Unreachable: a non-negative safe integer is < 2^53 < 2^56, so the loop
  // above always matches.
  throw new Error(`compact: value ${value} is out of range`);
};

const dec = createDecoder(bytes => {
  const first = u8.dec(bytes);
  if (first === 0) return 0;

  let value: number;
  if (first === 0xff) {
    // JAM's 9-byte form encodes values >= 2^56. Consume the bytes so the cursor
    // stays consistent, then fail the safe-integer check below.
    value = 0;
    for (let i = 0; i < 8; i++) value += u8.dec(bytes) * 2 ** (8 * i);
  } else {
    // `l` = count of leading 1-bits before the first 0-bit (from the MSB).
    let l = 0;
    while (l < 8 && (first & (0b1000_0000 >> l)) !== 0) l++;

    value = 0;
    for (let i = 0; i < l; i++) value += u8.dec(bytes) * 2 ** (8 * i);
    const rem = first & ((1 << (7 - l)) - 1);
    value += rem * 2 ** (8 * l);
  }

  if (!Number.isSafeInteger(value)) {
    throw new Error('compact: decoded value exceeds the safe integer range');
  }
  return value;
});

export const compact: Codec<number> = createCodec(enc, dec);

export { concatBytes };
