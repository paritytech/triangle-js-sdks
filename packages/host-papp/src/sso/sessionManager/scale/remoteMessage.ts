import { ContextualAlias, RingLocation } from '@novasamatech/host-api';
import type { CodecType } from 'scale-ts';
import { Bytes, Enum, Result, Struct, _void, str, u32 } from 'scale-ts';

import { SigningRequestCodec } from './signingRequest.js';
import { SigningResponseCodec } from './signingResponse.js';

const AliasRequestCodec = Struct({
  dotNsIdentifier: str,
  derivationIndex: u32,
});

const AliasResponseCodec = Struct({
  respondingTo: str,
  payload: Result(ContextualAlias, str),
});

const CreateProofRequestCodec = Struct({
  dotNsIdentifier: str,
  derivationIndex: u32,
  ringLocation: RingLocation,
  message: Bytes(),
});

const CreateProofResponseCodec = Struct({
  respondingTo: str,
  payload: Result(Bytes(), str),
});

export type RemoteMessage = CodecType<typeof RemoteMessageCodec>;
export const RemoteMessageCodec = Struct({
  messageId: str,
  data: Enum({
    v1: Enum({
      Disconnected: _void,
      SignRequest: SigningRequestCodec,
      SignResponse: SigningResponseCodec,
      AliasRequest: AliasRequestCodec,
      AliasResponse: AliasResponseCodec,
      CreateProofRequest: CreateProofRequestCodec,
      CreateProofResponse: CreateProofResponseCodec,
    }),
  }),
});
