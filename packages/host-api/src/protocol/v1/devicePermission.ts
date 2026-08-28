import { Status } from '@novasamatech/scale';
import { bool } from 'scale-ts';

import { CallResult } from '../callError.js';
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
export const DevicePermissionV1_response = CallResult(bool, GenericError);
