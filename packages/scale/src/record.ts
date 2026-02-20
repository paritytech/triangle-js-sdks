import type { Codec } from 'scale-ts';
import { Tuple, Vector, enhanceCodec, str } from 'scale-ts';

export function Record<T>(value: Codec<T>) {
  const vec = Vector(Tuple(str, value));

  return enhanceCodec<[string, T][], Record<string, T>>(
    vec,
    a => Object.entries(a),
    a => Object.fromEntries(a),
  );
}
