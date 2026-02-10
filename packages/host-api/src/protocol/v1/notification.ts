import { Result, _void, str } from 'scale-ts';

import { GenericError } from '../commonCodecs.js';

export const PushNotificationV1_request = str;
export const PushNotificationV1_response = Result(_void, GenericError);
