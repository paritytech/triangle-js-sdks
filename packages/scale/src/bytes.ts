import type { Codec } from 'scale-ts';
import { Bytes as ScaleBytes, enhanceCodec } from 'scale-ts';

/**
 * scale-ts `Codec` is a `[enc, dec]` tuple, so its `length` is fixed at 2 and cannot be
 * redefined — the fixed byte size is exposed as `size` instead.
 */
export type BytesCodec<Size extends number | undefined = number | undefined> = Codec<Uint8Array> & { size: Size };

/**
 * Wrapper around scale-ts `Bytes` codec.
 * With a fixed size, encoding throws when the value is longer and zero-pads it when shorter,
 * and decoding throws unless exactly that many bytes were available — scale-ts returns
 * whatever the stream had left, which silently yields a short value from a truncated record.
 * The fixed size, if any, is exposed as `codec.size`.
 */
export function Bytes(): BytesCodec<undefined>;
export function Bytes(size: number): BytesCodec<number>;
/** Pass-through for callers forwarding an optional size. */
export function Bytes(size: number | undefined): BytesCodec;
export function Bytes(size?: number): BytesCodec {
  const codec =
    size === undefined
      ? ScaleBytes()
      : enhanceCodec<Uint8Array, Uint8Array>(
          ScaleBytes(size),
          value => {
            if (value.length > size) throw new Error(`Bytes(${size}): value is too long (${value.length} bytes)`);
            if (value.length === size) return value;

            const padded = new Uint8Array(size);
            padded.set(value);
            return padded;
          },
          value => {
            if (value.length !== size) {
              throw new Error(`Bytes(${size}): decoded ${value.length} bytes, expected ${size}`);
            }

            return value;
          },
        );

  return Object.assign(codec, { size });
}
