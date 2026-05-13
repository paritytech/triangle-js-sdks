import { ErrEnum } from '@novasamatech/scale';
import { Option, Result, Struct, _void, str, u32, u64 } from 'scale-ts';

import { GenericErr, GenericError } from '../commonCodecs.js';

export const NotificationId = u32;

export const PushNotification = Struct({
  text: str,
  deeplink: Option(str),
  scheduledAt: Option(u64),
});

export const PushNotificationError = ErrEnum('PushNotificationError', {
  ScheduleLimitReached: [_void, 'Schedule limit reached'],
  Unknown: [GenericErr, 'Unknown error'],
});

export const PushNotificationV1_request = PushNotification;
export const PushNotificationV1_response = Result(NotificationId, PushNotificationError);

export const PushNotificationCancelV1_request = NotificationId;
export const PushNotificationCancelV1_response = Result(_void, GenericError);
