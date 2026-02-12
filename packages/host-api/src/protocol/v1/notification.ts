import { Option, Result, Struct, _void, str } from 'scale-ts';

import { GenericError } from '../commonCodecs.js';

export const PushNotification = Struct({
  text: str,
  deeplink: Option(str),
});

export const PushNotificationV1_request = PushNotification;
export const PushNotificationV1_response = Result(_void, GenericError);
