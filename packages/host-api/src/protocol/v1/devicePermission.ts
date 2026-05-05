import { Status } from '@novasamatech/scale';
import { Result, bool } from 'scale-ts';

import { GenericError } from '../commonCodecs.js';

export const DevicePermission = Status(
  'Notifications',
  'Camera',
  'Microphone',
  'Bluetooth',
  'NFC',
  'Location',
  'Clipboard',
  'OpenUrl',
  'Biometrics',
);

export const DevicePermissionV1_request = DevicePermission;
export const DevicePermissionV1_response = Result(bool, GenericError);
