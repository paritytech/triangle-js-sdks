import type { CodecType } from 'scale-ts';
import { Enum, Struct, _void, str } from 'scale-ts';

import {
  CreateTransactionLegacyRequestCodec,
  CreateTransactionRequestCodec,
  CreateTransactionResponseCodec,
} from './createTransaction.js';
import { ResourceAllocationRequestCodec, ResourceAllocationResponseCodec } from './resourceAllocation.js';
import { RingVrfAliasRequestCodec, RingVrfAliasResponseCodec } from './ringVrf.js';
import {
  SignRawLegacyRequestCodec,
  SignRawLegacyResponseCodec,
  SigningRequestCodec,
  SigningResponseCodec,
} from './signing.js';

export type RemoteMessage = CodecType<typeof RemoteMessageCodec>;
export const RemoteMessageCodec = Struct({
  messageId: str,
  data: Enum({
    v1: Enum({
      Disconnected: _void,
      SignRequest: SigningRequestCodec,
      SignResponse: SigningResponseCodec,
      RingVrfAliasRequest: RingVrfAliasRequestCodec,
      RingVrfAliasResponse: RingVrfAliasResponseCodec,
      ResourceAllocationRequest: ResourceAllocationRequestCodec,
      ResourceAllocationResponse: ResourceAllocationResponseCodec,
      CreateTransactionRequest: CreateTransactionRequestCodec,
      CreateTransactionResponse: CreateTransactionResponseCodec,
      CreateTransactionLegacyRequest: CreateTransactionLegacyRequestCodec,
      SignRawLegacyRequest: SignRawLegacyRequestCodec,
      SignRawLegacyResponse: SignRawLegacyResponseCodec,
    }),
  }),
});
