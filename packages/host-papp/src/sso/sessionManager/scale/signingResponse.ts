import type { CodecType } from 'scale-ts';
import { Bytes, Option, Result, Struct, str } from 'scale-ts';

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
