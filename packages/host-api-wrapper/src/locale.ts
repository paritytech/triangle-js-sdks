import type { CodecType, Subscription, Transport } from '@novasamatech/host-api';
import { HostLocale, createHostApi, enumValue } from '@novasamatech/host-api';

import { sandboxTransport } from './sandboxTransport.js';

export type Locale = CodecType<typeof HostLocale>;

export function createLocaleProvider(transport: Transport = sandboxTransport) {
  const hostApi = createHostApi(transport);

  return {
    subscribeLocale(callback: (locale: Locale) => void): Subscription<void> {
      const subscriber = hostApi.localeSubscribe(enumValue('v1', undefined), value => {
        if (value.tag === 'v1') {
          callback(value.value);
        }
      });

      return {
        unsubscribe: subscriber.unsubscribe,
        onInterrupt: cb => subscriber.onInterrupt(v => cb(v.value)),
      };
    },
  };
}
