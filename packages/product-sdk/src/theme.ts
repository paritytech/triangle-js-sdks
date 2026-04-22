import type { CodecType, Subscription, Transport } from '@novasamatech/host-api';
import { Theme, createHostApi, enumValue } from '@novasamatech/host-api';

import { sandboxTransport } from './sandboxTransport.js';

export type ThemeMode = CodecType<typeof Theme>;

export function createThemeProvider(transport: Transport = sandboxTransport) {
  const hostApi = createHostApi(transport);

  return {
    subscribeTheme(callback: (theme: ThemeMode) => void): Subscription<void> {
      const subscriber = hostApi.themeSubscribe(enumValue('v1', undefined), value => {
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
