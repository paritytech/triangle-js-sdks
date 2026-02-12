import { fromHex as papiFromHex, toHex as papiToHex } from '@polkadot-api/utils';
import type { ResultPayload } from 'scale-ts';

import type { HexString } from './hex.js';

export function unwrapResultOrThrow<Ok, Err>(response: ResultPayload<Ok, Err>, toError: (e: Err) => Error) {
  if (response.success) {
    return response.value;
  }

  throw toError(response.value);
}

export function resultOk<const T>(value: T) {
  return { success: true as const, value };
}

export function resultErr<const T>(e: T) {
  return { success: false as const, value: e };
}

export function enumValue<const Tag extends string, const Value>(tag: Tag, value: Value) {
  return { tag, value };
}

export function isEnumVariant<const Enum extends { tag: string; value: unknown }, const Tag extends Enum['tag']>(
  v: Enum,
  tag: Tag,
): v is Extract<Enum, { tag: Tag }> {
  return v.tag === tag;
}

export function assertEnumVariant<const Enum extends { tag: string; value: unknown }, const Tag extends Enum['tag']>(
  v: Enum,
  tag: Tag,
  message: string,
): asserts v is Extract<Enum, { tag: Tag }> {
  if (!isEnumVariant(v, tag)) {
    throw new Error(message);
  }
}

export function toHex(data: Uint8Array) {
  return papiToHex(data) as HexString;
}

export function fromHex(hex: string) {
  return papiFromHex(hex);
}
