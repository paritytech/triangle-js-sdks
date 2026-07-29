import { ProductAccountId, VrfSignature, VrfTranscriptItem } from '@novasamatech/host-api';
import { Bytes, ErrEnum } from '@novasamatech/scale';
import type { CodecType } from 'scale-ts';
import { Result, Struct, Vector, _void, str } from 'scale-ts';

/**
 * Host → Account Holder request for an sr25519 (schnorrkel) VRF signature over a
 * caller-supplied Merlin transcript (RFC-0023, "Accounts Protocol companion").
 *
 * The Account Holder derives `productAccountId`, presents the signing confirmation,
 * replays the transcript verbatim — `Transcript::new(transcriptLabel)` then one
 * `append_message(label, value)` per item, in order — and signs it. It performs no
 * interpretation of labels or values.
 *
 * This is the non-`AutoSigning` path; when `AutoSigning` covers the account the host
 * signs locally and never sends this message.
 */
export type SignVrfRequest = CodecType<typeof SignVrfRequestCodec>;
export const SignVrfRequestCodec = Struct({
  productAccountId: ProductAccountId,
  productId: str,
  transcriptLabel: Bytes(),
  items: Vector(VrfTranscriptItem),
});

/** Failure returned by the Account Holder for a VRF signing request. */
export type SignVrfErr = CodecType<typeof SignVrfErrCodec>;
export const SignVrfErrCodec = ErrEnum('SignVrfErr', {
  Rejected: [_void, 'Rejected'],
  Unknown: [Struct({ reason: str }), ({ reason }) => reason],
});

export type SignVrfResponse = CodecType<typeof SignVrfResponseCodec>;
export const SignVrfResponseCodec = Struct({
  // referencing to RemoteMessage.messageId
  respondingTo: str,
  payload: Result(VrfSignature, SignVrfErrCodec),
});
