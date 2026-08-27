import { createTransport } from '@novasamatech/host-api';
import type { Locale } from '@novasamatech/host-api-wrapper';
import { createLocaleProvider } from '@novasamatech/host-api-wrapper';
import type { ContainerHandlerOf } from '@novasamatech/host-container';
import { createContainer } from '@novasamatech/host-container';

import { describe, expect, it, vi } from 'vitest';

import { delay } from './__mocks__/helpers.js';
import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

// eslint-disable-next-line @typescript-eslint/no-empty-function
function noop() {}

function setup() {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host);
  const sdkTransport = createTransport(providers.sdk);
  const locale = createLocaleProvider(sdkTransport);
  return { container, locale };
}

describe('Host API: Locale', () => {
  describe('subscribeLocale', () => {
    it('should deliver the host language tag to the callback', async () => {
      const { container, locale } = setup();

      container.handleLocaleSubscribe((_params, send, _interrupt) => {
        send({ languageTag: 'en' });
        return noop;
      });

      const received: Locale[] = [];
      locale.subscribeLocale(l => received.push(l));

      await delay(50);

      expect(received).toEqual([{ languageTag: 'en' }]);
    });

    it('should preserve a script subtag through the codec', async () => {
      const { container, locale } = setup();

      container.handleLocaleSubscribe((_params, send, _interrupt) => {
        send({ languageTag: 'zh-Hans' });
        return noop;
      });

      const received: Locale[] = [];
      locale.subscribeLocale(l => received.push(l));

      await delay(50);

      expect(received).toEqual([{ languageTag: 'zh-Hans' }]);
    });

    it('should deliver successive locale updates in order', async () => {
      const { container, locale } = setup();

      container.handleLocaleSubscribe((_params, send, _interrupt) => {
        send({ languageTag: 'en' });
        send({ languageTag: 'de' });
        send({ languageTag: 'pt-BR' });
        return noop;
      });

      const received: Locale[] = [];
      locale.subscribeLocale(l => received.push(l));

      await delay(50);

      expect(received).toEqual([{ languageTag: 'en' }, { languageTag: 'de' }, { languageTag: 'pt-BR' }]);
    });

    it('should subscribe with the v1 start payload', async () => {
      const { container, locale } = setup();
      const handler = vi.fn<ContainerHandlerOf<typeof container.handleLocaleSubscribe>>(() => noop);
      container.handleLocaleSubscribe(handler);

      locale.subscribeLocale(noop);

      await delay(50);

      expect(handler).toHaveBeenCalledWith(undefined, expect.anything(), expect.anything());
    });
  });
});
