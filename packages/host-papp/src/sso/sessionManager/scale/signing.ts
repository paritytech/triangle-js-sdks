import { AccountId, ProductAccountId } from '@novasamatech/host-api';
import { Enum, Hex, OptionBool } from '@novasamatech/scale';
import type { CodecType } from 'scale-ts';
import { Bytes, Option, Result, Struct, Vector, str, u32 } from 'scale-ts';

export type SigningPayloadRequest = CodecType<typeof SigningPayloadRequestCodec>;
export const SigningPayloadRequestCodec = Struct({
  productAccountId: ProductAccountId,
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
  productAccountId: ProductAccountId,
  data: Enum({
    Bytes: Bytes(),
    Payload: str,
  }),
});

export type SignRawLegacyRequest = CodecType<typeof SignRawLegacyRequestCodec>;
export const SignRawLegacyRequestCodec = Struct({
  account: AccountId,
  data: Enum({
    Bytes: Bytes(),
    Payload: str,
  }),
});

export type SignRawLegacyResponse = CodecType<typeof SignRawLegacyResponseCodec>;
export const SignRawLegacyResponseCodec = Struct({
  // referencing to RemoteMessage.messageId
  respondingTo: str,
  signature: Result(Bytes(), str),
});

export type SigningRequest = CodecType<typeof SigningRequestCodec>;
export const SigningRequestCodec = Enum({
  Payload: SigningPayloadRequestCodec,
  Raw: SigningRawRequestCodec,
});

export type SigningPayloadResponseData = CodecType<typeof SigningPayloadResponseDataCodec>;
export const SigningPayloadResponseDataCodec = Struct({
  signature: Bytes(),
  signedTransaction: Option(Bytes()),
});

export type SigningPayloadResponse = CodecType<typeof SigningResponseCodec>;
export const SigningResponseCodec = Struct({
  // referencing to RemoteMessage.messageId
  respondingTo: str,
  payload: Result(SigningPayloadResponseDataCodec, str),
});
