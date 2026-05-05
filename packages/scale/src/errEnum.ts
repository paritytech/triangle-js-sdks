import type { Codec, CodecType } from 'scale-ts';
import { enhanceCodec } from 'scale-ts';

import type { EnumCodec } from './enum.js';
import { Enum } from './enum.js';
import type { CodecError, ErrCodec } from './err.js';
import { Err } from './err.js';

type ErrEnumArguments<T> = [value: Codec<T>, message: string | ((value: T) => string)];

type MapErrEnum<Name extends string, T extends Record<string, ErrEnumArguments<any>>> = {
  [K in keyof T]: ErrCodec<CodecType<T[K][0]>, K extends string ? `${Name}::${K}` : Name>;
};

type ErrEnumInput<Name extends string, T extends Record<string, ErrEnumArguments<any>>> = {
  [K in keyof T]: CodecError<CodecType<T[K][0]>, K extends string ? `${Name}::${K}` : Name>;
}[keyof T];

type ErrEnumCodec<Name extends string, T extends Record<string, ErrEnumArguments<any>>> = Codec<ErrEnumInput<Name, T>> &
  MapErrEnum<Name, T> & {
    [Symbol.hasInstance](v: unknown): v is ErrEnumInput<Name, T>;
  };

export function ErrEnum<const Name extends string, const T extends Record<string, ErrEnumArguments<any>>>(
  name: Name,
  inner: T,
): ErrEnumCodec<Name, T> {
  const variants = Object.fromEntries(
    Object.entries(inner).map(([k, [value, message]]) => [k, Err(`${name}::${k}`, value, message, k)]),
  ) as unknown as MapErrEnum<Name, T>;

  const codec = enhanceCodec<CodecType<EnumCodec<MapErrEnum<Name, T>>>, ErrEnumInput<Name, T>>(
    Enum(variants),
    v => ({ tag: v.instance, value: v }) as any,
    v => v.value as ErrEnumInput<Name, T>,
  );

  const result = Object.assign(codec, variants);
  // defineProperty (not Object.assign) so the symbol stays non-enumerable —
  // otherwise Object.assign'ing the codec into another target would propagate
  // the hasInstance hook and silently change that target's instanceof.
  Object.defineProperty(result, Symbol.hasInstance, {
    value: (v: unknown) => Object.values(variants).some(C => v instanceof (C as new (...args: any[]) => unknown)),
  });
  return result as ErrEnumCodec<Name, T>;
}
