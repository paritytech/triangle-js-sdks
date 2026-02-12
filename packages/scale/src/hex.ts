import { fromHex, toHex } from '@polkadot-api/utils';
import { Bytes, enhanceCodec } from 'scale-ts';

export type HexString = `0x${string}`;

/**
 * Wrapper around Bytes codec. Every usage of Hex codec should be threaded as raw Bytes with mapping to hex string.
 * @param [length] Optional, corresponds to byte array size, not the length of hex string.
 */
export const Hex = (length?: number) =>
  enhanceCodec<Uint8Array, HexString>(Bytes(length), fromHex, v => toHex(v) as HexString);
