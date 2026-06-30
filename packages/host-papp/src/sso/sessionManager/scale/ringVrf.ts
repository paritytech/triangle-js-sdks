import {
  ContextualAlias,
  DotNsIdentifier,
  ProductProofContext,
  RingLocation,
  RingVrfProof,
} from '@novasamatech/host-api';
import type { CodecType } from 'scale-ts';
import { Bytes, Result, Struct, str } from 'scale-ts';

export type RingVrfAliasRequest = CodecType<typeof RingVrfAliasRequestCodec>;
export const RingVrfAliasRequestCodec = Struct({
  callingProductId: DotNsIdentifier,
  context: ProductProofContext,
  ring: RingLocation,
});

export type RingVrfAliasResponse = CodecType<typeof RingVrfAliasResponseCodec>;
export const RingVrfAliasResponseCodec = Struct({
  respondingTo: str,
  payload: Result(ContextualAlias, str),
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
  payload: Result(RingVrfProof, str),
});
