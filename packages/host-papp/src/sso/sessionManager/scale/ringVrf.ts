import {
  ContextualAlias,
  DotNsIdentifier,
  ProductProofContext,
  RingLocation,
  RingVrfProof,
} from '@novasamatech/host-api';
import { ErrEnum } from '@novasamatech/scale';
import type { CodecType } from 'scale-ts';
import { Bytes, Result, Struct, _void, str } from 'scale-ts';

// Shared failure set for both alias and proof requests over the SSO channel;
// mirrors the Account Holder's `RingVrfError` (RFC 0004).
export const RingVrfError = ErrEnum('RingVrfError', {
  RingNotFound: [_void, 'RingVrf: ring not found'],
  NotMember: [_void, 'RingVrf: selected member key is not a member of the ring'],
  Rejected: [_void, 'RingVrf: rejected'],
  Unknown: [Struct({ reason: str }), 'RingVrf: unknown error'],
});

export type RingVrfAliasRequest = CodecType<typeof RingVrfAliasRequestCodec>;
export const RingVrfAliasRequestCodec = Struct({
  callingProductId: DotNsIdentifier,
  context: ProductProofContext,
  ring: RingLocation,
});

export type RingVrfAliasResponse = CodecType<typeof RingVrfAliasResponseCodec>;
export const RingVrfAliasResponseCodec = Struct({
  respondingTo: str,
  payload: Result(ContextualAlias, RingVrfError),
});

export type RingVrfProofRequest = CodecType<typeof RingVrfProofRequestCodec>;
export const RingVrfProofRequestCodec = Struct({
  callingProductId: DotNsIdentifier,
  context: ProductProofContext,
  ring: RingLocation,
  message: Bytes(),
});

export type RingVrfProofResponse = CodecType<typeof RingVrfProofResponseCodec>;
export const RingVrfProofResponseCodec = Struct({
  respondingTo: str,
  payload: Result(RingVrfProof, RingVrfError),
});
