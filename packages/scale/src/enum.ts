import type { Codec, StringRecord } from 'scale-ts';
import { Enum as ScaleEnum } from 'scale-ts';

type FilterStringRecord<T extends Record<string, Codec<any>>> = T extends StringRecord<Codec<any>> ? T : never;

export type EnumCodec<T extends Record<string, Codec<any>>> = ReturnType<typeof Enum<T>>;

/**
 * Wraps scale-ts `Enum`. The optional `indexes` array pins each variant's
 * serialization index positionally (i-th key gets `indexes[i]`), so the on-wire
 * ABI no longer depends on declaration/iteration order.
 */
export const Enum = <T extends Record<string, Codec<any>>>(inner: T, indexes?: number[]) =>
  ScaleEnum(inner as FilterStringRecord<T>, indexes as never);
