import type { CodecType, Transport } from '@novasamatech/host-api';
import { Theme, createHostApi, enumValue } from '@novasamatech/host-api';

import { sandboxTransport } from './sandboxTransport.js';

export type ThemeMode = CodecType<typeof Theme>;

export type ThemeSubscription = {
  unsubscribe: VoidFunction;
};

export function createThemeProvider(transport: Transport = sandboxTransport) {
  const hostApi = createHostApi(transport);

  return {
    subscribeTheme(callback: (theme: ThemeMode) => void): ThemeSubscription {
      const subscription = hostApi.themeSubscribe(enumValue('v1', undefined), value => {
        if (value.tag === 'v1') {
          callback(value.value);
        }
      });

      return {
        unsubscribe: subscription.unsubscribe,
      };
    },
  };
}
