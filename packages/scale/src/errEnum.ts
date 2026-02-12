import type { Codec, CodecType } from 'scale-ts';
import { enhanceCodec } from 'scale-ts';

import type { EnumCodec } from './enum.js';
import { Enum } from './enum.js';
import type { CodecError, ErrCodec } from './err.js';
import { Err } from './err.js';

type MapErrEnum<Name extends string, T extends Record<string, ErrEnumArguments<any>>> = {
  [K in keyof T]: ErrCodec<CodecType<T[K][0]>, K extends string ? `${Name}::${K}` : Name>;
};

type ErrEnumInput<Name extends string, T extends Record<string, ErrEnumArguments<any>>> = {
  [K in keyof T]: CodecError<CodecType<T[K][0]>, K extends string ? `${Name}::${K}` : Name>;
}[keyof T];

type ErrEnumArguments<T> = [value: Codec<T>, message: string | ((value: T) => string)];

export function ErrEnum<const Name extends string, const T extends Record<string, ErrEnumArguments<any>>>(
  name: Name,
  inner: T,
): Codec<ErrEnumInput<Name, T>> & MapErrEnum<Name, T> {
  const values = Object.fromEntries(
    Object.entries(inner).map(([k, [value, message]]) => {
      return [k, Err(`${name}::${k}`, value, message, k)];
    }),
  ) as never as MapErrEnum<Name, T>;

  const codec = enhanceCodec<CodecType<EnumCodec<MapErrEnum<Name, T>>>, ErrEnumInput<Name, T>>(
    Enum(values),
    v => ({ tag: v.instance, value: v }) as any,
    v => v.value as ErrEnumInput<Name, T>,
  );

  return Object.assign(codec, values);
}
