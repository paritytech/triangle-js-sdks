import type { Codec } from 'scale-ts';
import { Bytes as ScaleBytes, enhanceCodec } from 'scale-ts';

/**
 * scale-ts `Codec` is a `[enc, dec]` tuple, so its `length` is fixed at 2 and cannot be
 * redefined — the fixed byte size is exposed as `size` instead.
 */
export type BytesCodec = Codec<Uint8Array> & { size?: number };

/**
 * Wrapper around scale-ts `Bytes` codec.
 * With a fixed size, encoding throws when the value is longer and zero-pads it when shorter.
 * The fixed size, if any, is exposed as `codec.size`.
 */
export const Bytes = (size?: number): BytesCodec => {
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
          value => value,
        );

  return Object.assign(codec, { size });
};
