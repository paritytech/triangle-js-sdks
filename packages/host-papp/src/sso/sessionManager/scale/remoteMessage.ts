import { ContextualAlias, RingLocation } from '@novasamatech/host-api';
import type { CodecType } from 'scale-ts';
import { Bytes, Enum, Result, Struct, _void, str, u32 } from 'scale-ts';

import { SigningRequestCodec } from './signingRequest.js';
import { SigningResponseCodec } from './signingResponse.js';

const RingVrfAliasRequestCodec = Struct({
  dotNsIdentifier: str,
  derivationIndex: u32,
});

const RingVrfAliasResponseCodec = Struct({
  respondingTo: str,
  payload: Result(ContextualAlias, str),
});

const RingVrfCreateProofRequestCodec = Struct({
  dotNsIdentifier: str,
  derivationIndex: u32,
  ringLocation: RingLocation,
  message: Bytes(),
});

const RingVrfCreateProofResponseCodec = Struct({
  respondingTo: str,
  payload: Result(Bytes(), str),
});

export type RemoteMessage = CodecType<typeof RemoteMessageCodec>;
export const RemoteMessageCodec = Struct({
  messageId: str,
  productDotNsIdentifier: str,
  data: Enum({
    v1: Enum({
      Disconnected: _void,
      SignRequest: SigningRequestCodec,
      SignResponse: SigningResponseCodec,
      RingVrfAliasRequest: RingVrfAliasRequestCodec,
      RingVrfAliasResponse: RingVrfAliasResponseCodec,
      RingVrfCreateProofRequest: RingVrfCreateProofRequestCodec,
      RingVrfCreateProofResponse: RingVrfCreateProofResponseCodec,
    }),
  }),
});
