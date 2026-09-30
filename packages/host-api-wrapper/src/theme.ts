import type { CodecType, Subscription, Transport } from '@novasamatech/host-api';
import { Theme, createHostApi, enumValue } from '@novasamatech/host-api';

import type { GenericInterrupt } from './helpers.js';
import { genericInterrupt, unwrapVersionedSubscription } from './helpers.js';
import { sandboxTransport } from './sandboxTransport.js';

export type ThemeMode = CodecType<typeof Theme>;

export function createThemeProvider(transport: Transport = sandboxTransport) {
  const hostApi = createHostApi(transport);

  return {
    subscribeTheme(callback: (theme: ThemeMode) => void): Subscription<GenericInterrupt | undefined> {
      return unwrapVersionedSubscription(
        hostApi.theme.subscribe(enumValue('v1', undefined), value => {
          if (value.tag === 'v1') {
            callback(value.value);
          }
        }),
        genericInterrupt,
      );
    },
  };
}
