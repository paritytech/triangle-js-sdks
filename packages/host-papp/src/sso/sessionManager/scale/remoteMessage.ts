import type { CodecType } from 'scale-ts';
import { Enum, Struct, _void, str } from 'scale-ts';

import { RingVrfAliasRequestCodec, RingVrfAliasResponseCodec } from './ringVrf.js';
import { SigningRequestCodec } from './signingRequest.js';
import { SigningResponseCodec } from './signingResponse.js';

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
    }),
  }),
});
