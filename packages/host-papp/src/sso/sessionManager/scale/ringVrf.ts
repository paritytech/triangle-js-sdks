import { ContextualAlias, ProductAccountId } from '@novasamatech/host-api';
import type { CodecType } from 'scale-ts';
import { Result, Struct, str } from 'scale-ts';

export type RingVrfAliasRequest = CodecType<typeof RingVrfAliasRequestCodec>;
export const RingVrfAliasRequestCodec = Struct({
  productAccountId: ProductAccountId,
  productId: str,
});

export type RingVrfAliasResponse = CodecType<typeof RingVrfAliasResponseCodec>;
export const RingVrfAliasResponseCodec = Struct({
  respondingTo: str,
  payload: Result(ContextualAlias, str),
});
