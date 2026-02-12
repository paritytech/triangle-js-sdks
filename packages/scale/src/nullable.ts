import type { Codec } from 'scale-ts';
import { Option, enhanceCodec } from 'scale-ts';

export function Nullable<T>(inner: Codec<T>) {
  return enhanceCodec<T | undefined, T | null>(
    Option(inner),
    v => (v === null ? undefined : v),
    v => (v === undefined ? null : v),
  );
}
