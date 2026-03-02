import { Enum, Hex, OptionBool } from '@novasamatech/scale';
import type { CodecType } from 'scale-ts';
import { Bytes, Option, Struct, Vector, str, u32 } from 'scale-ts';

export type SigningPayloadRequest = CodecType<typeof SigningPayloadRequestCodec>;
export const SigningPayloadRequestCodec = Struct({
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
  withSignedTransaction: OptionBool,
});

export type SigningRawRequest = CodecType<typeof SigningRawRequestCodec>;
export const SigningRawRequestCodec = Struct({
  address: str,
  data: Enum({
    Bytes: Bytes(),
    Payload: str,
  }),
});

export type SigningRequest = CodecType<typeof SigningRequestCodec>;
export const SigningRequestCodec = Enum({
  Payload: SigningPayloadRequestCodec,
  Raw: SigningRawRequestCodec,
});
