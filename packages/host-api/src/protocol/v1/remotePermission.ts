import { Enum } from '@novasamatech/scale';
import { Result, Vector, _void, bool, str } from 'scale-ts';

import { GenericError } from '../commonCodecs.js';

export const RemotePermission = Enum({
  Remote: Vector(str),
  WebRTC: _void,
  ChainSubmit: _void,
  PreimageSubmit: _void,
  StatementSubmit: _void,
});

export const RemotePermissionV1_request = Vector(RemotePermission);
export const RemotePermissionV1_response = Result(bool, GenericError);
