import { Enum } from '@novasamatech/scale';
import { Result, Vector, _void, bool, str } from 'scale-ts';

import { GenericError } from '../commonCodecs.js';

export const RemotePermission = Enum({
  Remote: Vector(str),
  WebRtc: _void,
  ChainSubmit: _void,
  PreimageSubmit: _void,
  StatementSubmit: _void,
});

export const RemotePermissionV1_request = RemotePermission;
export const RemotePermissionV1_response = Result(bool, GenericError);
