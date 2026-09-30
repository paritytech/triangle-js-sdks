import type { CodecType, Subscription, Transport } from '@novasamatech/host-api';
import { HostLocale, createHostApi, enumValue } from '@novasamatech/host-api';

import type { GenericInterrupt } from './helpers.js';
import { genericInterrupt, unwrapVersionedSubscription } from './helpers.js';
import { sandboxTransport } from './sandboxTransport.js';

export type Locale = CodecType<typeof HostLocale>;

export function createLocaleProvider(transport: Transport = sandboxTransport) {
  const hostApi = createHostApi(transport);

  return {
    subscribeLocale(callback: (locale: Locale) => void): Subscription<GenericInterrupt | undefined> {
      return unwrapVersionedSubscription(
        hostApi.locale.subscribe(enumValue('v1', undefined), value => {
          if (value.tag === 'v1') {
            callback(value.value);
          }
        }),
        genericInterrupt,
      );
    },
  };
}
