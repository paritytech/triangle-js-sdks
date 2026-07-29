import { fromHex, toHex } from '@polkadot-api/utils';
import type { Codec } from 'scale-ts';
import { enhanceCodec } from 'scale-ts';

import { Bytes } from './bytes.js';

export type HexString = `0x${string}`;

export type HexCodec<Size extends number | undefined = number | undefined> = Codec<HexString> & { size: Size };

/**
 * Wrapper around {@link Bytes} codec. Every usage of Hex codec should be threaded as raw Bytes with mapping to hex string.
 * @param [size] Optional, corresponds to byte array size, not the length of hex string.
 */
export function Hex(): HexCodec<undefined>;
export function Hex(size: number): HexCodec<number>;
export function Hex(size?: number): HexCodec {
  const bytes = size === undefined ? Bytes() : Bytes(size);

  return Object.assign(
    enhanceCodec<Uint8Array, HexString>(bytes, fromHex, v => toHex(v) as HexString),
    { size },
  );
}
