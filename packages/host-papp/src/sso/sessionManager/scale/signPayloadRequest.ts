import { Hex } from '@novasamatech/scale';
import type { CodecType } from 'scale-ts';
import { Option, Struct, Vector, bool, str, u32 } from 'scale-ts';

export type SignPayloadRequest = CodecType<typeof SignPayloadRequestCodec>;
export const SignPayloadRequestCodec = Struct({
  address: str,
  blockHash: Hex(),
  blockNumber: Hex(),
  era: Hex(),
  genesisHash: Hex(),
  method: Hex(),
  nonce: Hex(),
  specVersion: Hex(),
  tip: Hex(),
  transactionVersion: Hex(),
  signedExtensions: Vector(str),
  version: u32,
  assetId: Option(Hex()),
  metadataHash: Option(Hex()),
  mode: Option(u32),
  withSignedTransaction: Option(bool),
});
