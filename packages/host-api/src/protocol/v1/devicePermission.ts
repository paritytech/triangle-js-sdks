import { Enum } from '@novasamatech/scale';
import { Result, _void, bool } from 'scale-ts';

import { GenericError } from '../commonCodecs.js';

export const DevicePermissionRequest = Enum({
  Camera: _void,
  Microphone: _void,
  Bluetooth: _void,
  Location: _void,
});

export const DevicePermissionV1_request = DevicePermissionRequest;
export const DevicePermissionV1_response = Result(bool, GenericError);
