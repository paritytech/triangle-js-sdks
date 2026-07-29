import { fromHex, toHex } from '@polkadot-api/utils';
import type { Codec } from 'scale-ts';
import { enhanceCodec } from 'scale-ts';

import { Bytes } from './bytes.js';

export type HexString = `0x${string}`;

export type HexCodec = Codec<HexString> & { size?: number };

/**
 * Wrapper around {@link Bytes} codec. Every usage of Hex codec should be threaded as raw Bytes with mapping to hex string.
 * @param [size] Optional, corresponds to byte array size, not the length of hex string.
 */
export const Hex = (size?: number): HexCodec =>
  Object.assign(
    enhanceCodec<Uint8Array, HexString>(Bytes(size), fromHex, v => toHex(v) as HexString),
    { size },
  );
