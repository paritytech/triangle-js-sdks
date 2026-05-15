import { createHostApi, enumValue } from '@novasamatech/host-api';

import { resultToPromise, unwrapVersionedResult } from './helpers.js';
import { sandboxTransport } from './sandboxTransport.js';

export type NotificationId = number;

export type PushNotificationInput = {
  text: string;
  deeplink?: string;
  /** Unix timestamp in milliseconds (UTC). Omit for immediate delivery. Past values fire immediately. */
  scheduledAt?: number;
};

export const createNotificationManager = (transport = sandboxTransport) => {
  const supportedVersion = 'v1';
  const hostApi = createHostApi(transport);

  return {
    push({ text, deeplink, scheduledAt }: PushNotificationInput): Promise<NotificationId> {
      return resultToPromise(
        unwrapVersionedResult(
          supportedVersion,
          hostApi.pushNotification(
            enumValue(supportedVersion, {
              text,
              deeplink,
              scheduledAt: scheduledAt === undefined ? undefined : BigInt(scheduledAt),
            }),
          ),
        ),
      );
    },
    cancel(id: NotificationId): Promise<void> {
      return resultToPromise(
        unwrapVersionedResult(supportedVersion, hostApi.pushNotificationCancel(enumValue(supportedVersion, id))),
      );
    },
  };
};

export const notificationManager = createNotificationManager();
