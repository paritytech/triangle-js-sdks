import { Enum } from '@novasamatech/scale';
import type { CodecType } from 'scale-ts';
import { Struct, _void, str } from 'scale-ts';

import {
  CreateTransactionLegacyRequestCodec,
  CreateTransactionRequestCodec,
  CreateTransactionResponseCodec,
} from './createTransaction.js';
import { ResourceAllocationRequestCodec, ResourceAllocationResponseCodec } from './resourceAllocation.js';
import { RingVrfAliasRequestCodec, RingVrfAliasResponseCodec } from './ringVrf.js';
import { SignVrfRequestCodec, SignVrfResponseCodec } from './signVrf.js';
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
    v1: Enum(
      {
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
        SignVrfRequest: SignVrfRequestCodec,
        SignVrfResponse: SignVrfResponseCodec,
      },
      // Indices are pinned rather than implied by declaration order: 12 and 13 are
      // held by the truapi `RingVrfProofRequest`/`RingVrfProofResponse` variants,
      // which this SDK does not implement yet, so the VRF-signing pair takes 14/15.
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 15],
    ),
  }),
});
