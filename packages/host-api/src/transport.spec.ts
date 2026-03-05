import { createNanoEvents } from 'nanoevents';
import { describe, expect, it, vi } from 'vitest';

import { createDefaultLogger } from './logger.js';
import type { Provider } from './provider.js';
import { createTransport } from './transport.js';

function createProviders() {
  type Events = 'toHost' | 'toSdk';
  const bus = createNanoEvents<Record<Events, (v: Uint8Array) => void>>();

  function createProvider(listenTo: Events, postTo: Events): Provider {
    return {
      logger: createDefaultLogger(),
      isCorrectEnvironment: () => true,
      dispose: () => delete bus.events[listenTo],
      subscribe: callback => bus.on(listenTo, callback),
      postMessage: message => bus.emit(postTo, message),
    };
  }

  return {
    host: createProvider('toHost', 'toSdk'),
    sdk: createProvider('toSdk', 'toHost'),
  };
}

describe('transport', () => {
  describe('subscription', () => {
    it('should multiplex subscriptions', () => {
      const providers = createProviders();
      const events = createNanoEvents<{ push: VoidFunction; unsub: VoidFunction }>();

      const host = createTransport(providers.host);
      const sdk = createTransport(providers.sdk);

      const hostUnsubscribe = vi.fn();

      const containerHandler = vi.fn((_, send) => {
        const unsub = events.on('push', () => {
          send({ tag: 'v1', value: 'connected' });
        });
        return () => {
          unsub();
          hostUnsubscribe();
        };
      });

      host.handleSubscription('host_account_connection_status_subscribe', containerHandler);

      const s1Handler = vi.fn();
      const s1 = sdk.subscribe('host_account_connection_status_subscribe', { tag: 'v1', value: undefined }, s1Handler);

      const s2Handler = vi.fn();
      const s2 = sdk.subscribe('host_account_connection_status_subscribe', { tag: 'v1', value: undefined }, s2Handler);

      events.emit('push');

      expect(s1Handler).toHaveBeenCalledTimes(1);
      expect(s2Handler).toHaveBeenCalledTimes(1);

      s1.unsubscribe();
      expect(hostUnsubscribe).not.toBeCalled();

      events.emit('push');

      expect(s1Handler).toHaveBeenCalledTimes(1);
      expect(s2Handler).toHaveBeenCalledTimes(2);

      s2.unsubscribe();
      expect(hostUnsubscribe).toHaveBeenCalledTimes(1);

      events.emit('push');

      expect(s1Handler).toHaveBeenCalledTimes(1);
      expect(s2Handler).toHaveBeenCalledTimes(2);
    });
  });
});
