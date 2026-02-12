import type { Codec, StringRecord } from 'scale-ts';
import { Enum as ScaleEnum } from 'scale-ts';

type FilterStringRecord<T extends Record<string, Codec<any>>> = T extends StringRecord<Codec<any>> ? T : never;

export type EnumCodec<T extends Record<string, Codec<any>>> = ReturnType<typeof Enum<T>>;
export const Enum = <T extends Record<string, Codec<any>>>(inner: T) => ScaleEnum(inner as FilterStringRecord<T>);
