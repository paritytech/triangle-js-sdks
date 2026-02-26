import type { Codec } from 'scale-ts';
import { createCodec } from 'scale-ts';

export function lazy<T>(fn: () => Codec<T>): Codec<T> {
  return createCodec<T>(
    v => fn().enc(v),
    v => fn().dec(v),
  );
}
