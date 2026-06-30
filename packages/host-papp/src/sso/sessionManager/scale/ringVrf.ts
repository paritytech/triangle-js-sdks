import { ContextualAlias, ProductProofContext, RingLocation } from '@novasamatech/host-api';
import type { CodecType } from 'scale-ts';
import { Result, Struct, str } from 'scale-ts';

export type RingVrfAliasRequest = CodecType<typeof RingVrfAliasRequestCodec>;
export const RingVrfAliasRequestCodec = Struct({
  context: ProductProofContext,
  ring: RingLocation,
});

export type RingVrfAliasResponse = CodecType<typeof RingVrfAliasResponseCodec>;
export const RingVrfAliasResponseCodec = Struct({
  respondingTo: str,
  payload: Result(ContextualAlias, str),
});
