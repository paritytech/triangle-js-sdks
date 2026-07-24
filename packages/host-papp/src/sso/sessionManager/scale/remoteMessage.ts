import { Enum } from '@novasamatech/scale';
import type { CodecType } from 'scale-ts';
import { Struct, _void, str } from 'scale-ts';

import {
  CreateTransactionLegacyRequestCodec,
  CreateTransactionRequestCodec,
  CreateTransactionResponseCodec,
} from './createTransaction.js';
import { ResourceAllocationRequestCodec, ResourceAllocationResponseCodec } from './resourceAllocation.js';
import {
  RingVrfAliasRequestCodec,
  RingVrfAliasResponseCodec,
  RingVrfProofRequestCodec,
  RingVrfProofResponseCodec,
} from './ringVrf.js';
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
    // Declaration order is the SCALE wire order and must stay in lockstep with the
    // truapi `host_logic::sso::messages::v1::RemoteMessage` enum. Append only.
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
      RingVrfProofRequest: RingVrfProofRequestCodec,
      RingVrfProofResponse: RingVrfProofResponseCodec,
      SignVrfRequest: SignVrfRequestCodec,
      SignVrfResponse: SignVrfResponseCodec,
    }),
  }),
});
