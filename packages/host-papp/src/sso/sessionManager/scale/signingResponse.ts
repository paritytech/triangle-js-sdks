import type { CodecType } from 'scale-ts';
import { Bytes, Option, Result, Struct, str } from 'scale-ts';

export type SignPayloadResponseData = CodecType<typeof SignPayloadResponseDataCodec>;
export const SignPayloadResponseDataCodec = Struct({
  signature: Bytes(),
  signedTransaction: Option(Bytes()),
});

export type SignPayloadResponse = CodecType<typeof SigningResponseCodec>;
export const SigningResponseCodec = Struct({
  // referencing to RemoteMessage.messageId
  respondingTo: str,
  payload: Result(SignPayloadResponseDataCodec, str),
});
