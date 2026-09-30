import { GenericError, createTransport } from '@novasamatech/host-api';
import type { ThemeMode } from '@novasamatech/host-api-wrapper';
import { createThemeProvider } from '@novasamatech/host-api-wrapper';
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
  const theme = createThemeProvider(sdkTransport);
  return { container, theme };
}

describe('Host API: Theme', () => {
  describe('subscribeTheme', () => {
    it('should deliver a default/light theme to the callback', async () => {
      const { container, theme } = setup();

      container.theme.handleSubscribe((_params, send, _interrupt) => {
        send({ name: { tag: 'Default', value: undefined }, variant: 'Light' });
        return noop;
      });

      const received: ThemeMode[] = [];
      theme.subscribeTheme(t => received.push(t));

      await delay(50);

      expect(received).toEqual([{ name: { tag: 'Default', value: undefined }, variant: 'Light' }]);
    });

    it('should deliver a custom-named theme with its variant', async () => {
      const { container, theme } = setup();

      container.theme.handleSubscribe((_params, send, _interrupt) => {
        send({ name: { tag: 'Custom', value: 'midnight' }, variant: 'Dark' });
        return noop;
      });

      const received: ThemeMode[] = [];
      theme.subscribeTheme(t => received.push(t));

      await delay(50);

      expect(received).toEqual([{ name: { tag: 'Custom', value: 'midnight' }, variant: 'Dark' }]);
    });

    it('should deliver successive theme updates in order', async () => {
      const { container, theme } = setup();

      container.theme.handleSubscribe((_params, send, _interrupt) => {
        send({ name: { tag: 'Default', value: undefined }, variant: 'Light' });
        send({ name: { tag: 'Default', value: undefined }, variant: 'Dark' });
        send({ name: { tag: 'Custom', value: 'solarized' }, variant: 'Light' });
        return noop;
      });

      const received: ThemeMode[] = [];
      theme.subscribeTheme(t => received.push(t));

      await delay(50);

      expect(received).toEqual([
        { name: { tag: 'Default', value: undefined }, variant: 'Light' },
        { name: { tag: 'Default', value: undefined }, variant: 'Dark' },
        { name: { tag: 'Custom', value: 'solarized' }, variant: 'Light' },
      ]);
    });

    it('should subscribe with the v1 start payload', async () => {
      const { container, theme } = setup();
      const handler = vi.fn<ContainerHandlerOf<typeof container.theme.handleSubscribe>>(() => noop);
      container.theme.handleSubscribe(handler);

      theme.subscribeTheme(noop);

      await delay(50);

      expect(handler).toHaveBeenCalledWith(undefined, expect.anything(), expect.anything());
    });
  });

  describe('onInterrupt', () => {
    it('receives undefined when the host ends the stream cleanly', async () => {
      const { container, theme } = setup();

      container.theme.handleSubscribe((_params, _send, interrupt) => {
        interrupt(undefined);
        return noop;
      });

      const reasons: unknown[] = [];
      theme.subscribeTheme(noop).onInterrupt(reason => reasons.push(reason));

      await delay(50);

      expect(reasons).toEqual([undefined]);
    });

    it('receives the host GenericError', async () => {
      const { container, theme } = setup();
      const error = new GenericError({ reason: 'theme service down' });

      container.theme.handleSubscribe((_params, _send, interrupt) => {
        interrupt(error);
        return noop;
      });

      const reasons: unknown[] = [];
      theme.subscribeTheme(noop).onInterrupt(reason => reasons.push(reason));

      await delay(50);

      expect(reasons).toEqual([error]);
    });

    it('folds the default Unsupported interrupt into a GenericError when no handler is registered', async () => {
      const { theme } = setup();

      const reasons: unknown[] = [];
      theme.subscribeTheme(noop).onInterrupt(reason => reasons.push(reason));

      await delay(50);

      expect(reasons).toEqual([new GenericError({ reason: 'method unsupported by host' })]);
    });
  });
});
