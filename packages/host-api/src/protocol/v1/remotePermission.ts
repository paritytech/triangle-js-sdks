import { Enum } from '@novasamatech/scale';
import { Result, _void, bool, str } from 'scale-ts';

import { GenericError } from '../commonCodecs.js';

export const RemotePermissionRequest = Enum({
  ExternalRequest: str, // URL
  TransactionSubmit: _void,
});

export const RemotePermissionV1_request = RemotePermissionRequest;
export const RemotePermissionV1_response = Result(bool, GenericError);
