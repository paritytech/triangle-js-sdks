import { Status } from '@novasamatech/scale';
import { Result, bool } from 'scale-ts';

import { GenericError } from '../commonCodecs.js';

export const DevicePermissionRequest = Status('Camera', 'Microphone', 'Bluetooth', 'Location');

export const DevicePermissionV1_request = DevicePermissionRequest;
export const DevicePermissionV1_response = Result(bool, GenericError);
