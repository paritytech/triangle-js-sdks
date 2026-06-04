import { enumValue } from '@novasamatech/scale';
import { createNanoEvents } from 'nanoevents';
import { describe, expect, it, vi } from 'vitest';

import { SCALE_CODEC_PROTOCOL_ID } from './constants.js';
import { createDefaultLogger } from './logger.js';
import type { Provider } from './provider.js';
import { createTransport } from './transport.js';
import type { DebugMessageEvent } from './types.js';

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

const samplePayload = () => enumValue('host_handshake_request', enumValue('v1', SCALE_CODEC_PROTOCOL_ID));

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

  describe('debug hook', () => {
    it('emits outgoing events when postMessage is called and still delivers the message', () => {
      const providers = createProviders();
      const host = createTransport(providers.host);
      const sdk = createTransport(providers.sdk);

      const debugListener = vi.fn<(e: DebugMessageEvent) => void>();
      host.onDebugMessage(debugListener);

      const sdkReceived = vi.fn();
      sdk.listenMessages('host_handshake_request', sdkReceived);

      const requestId = 'req-1';
      const payload = samplePayload();
      host.postMessage(requestId, payload);

      expect(debugListener).toHaveBeenCalledTimes(1);
      expect(debugListener).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'outgoing', requestId, payload }),
      );
      expect(sdkReceived).toHaveBeenCalledTimes(1);
      expect(sdkReceived).toHaveBeenCalledWith(requestId, expect.objectContaining({ tag: 'host_handshake_request' }));
    });

    it('emits incoming events with decoded payload', () => {
      const providers = createProviders();
      const host = createTransport(providers.host);
      const sdk = createTransport(providers.sdk);

      const debugListener = vi.fn<(e: DebugMessageEvent) => void>();
      host.onDebugMessage(debugListener);

      const requestId = 'req-2';
      const payload = samplePayload();
      sdk.postMessage(requestId, payload);

      // host receives sdk's message, plus host's own outgoing handshake
      // attempts (none yet, since isReady() wasn't called). Filter to incoming.
      const incoming = debugListener.mock.calls.map(([event]) => event).filter(e => e.direction === 'incoming');

      expect(incoming).toHaveLength(1);
      expect(incoming[0]).toEqual(
        expect.objectContaining({
          direction: 'incoming',
          requestId,
          payload: expect.objectContaining({ tag: 'host_handshake_request' }),
        }),
      );
    });

    it('supports multiple listeners and stops after unsubscribe', () => {
      const providers = createProviders();
      const host = createTransport(providers.host);

      const a = vi.fn<(e: DebugMessageEvent) => void>();
      const b = vi.fn<(e: DebugMessageEvent) => void>();
      const unsubscribeA = host.onDebugMessage(a);
      host.onDebugMessage(b);

      host.postMessage('req-a', samplePayload());
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);

      unsubscribeA();
      // calling unsubscribe twice must be a no-op
      unsubscribeA();

      host.postMessage('req-b', samplePayload());
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(2);
    });

    it('survives a throwing listener without breaking delivery', () => {
      const providers = createProviders();
      const host = createTransport(providers.host);
      const sdk = createTransport(providers.sdk);

      // Swap console.error directly so the expected throws don't pollute test
      // output. Transport routes debug-callback failures to console.error (not
      // provider.logger) so they stay distinct from real protocol errors.
      const originalConsoleError = console.error;
      const errorSpy = vi.fn();
      console.error = errorSpy;
      try {
        host.onDebugMessage(() => {
          throw new Error('listener boom');
        });
        const goodListener = vi.fn<(e: DebugMessageEvent) => void>();
        host.onDebugMessage(goodListener);

        const sdkReceived = vi.fn();
        sdk.listenMessages('host_handshake_request', sdkReceived);

        // outgoing: a throwing listener must not block messageProvider.postMessage
        host.postMessage('out-1', samplePayload());
        expect(sdkReceived).toHaveBeenCalledTimes(1);

        // incoming: a throwing listener must not block other host listenMessages subscribers
        const hostReceived = vi.fn();
        host.listenMessages('host_handshake_request', hostReceived);
        sdk.postMessage('in-1', samplePayload());
        expect(hostReceived).toHaveBeenCalledTimes(1);

        // the second good listener still fired despite the first one throwing
        expect(goodListener).toHaveBeenCalled();
        // and the throws were observed on console.error, not propagated
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        console.error = originalConsoleError;
      }
    });

    it('cleans up the debug subscription on destroy() and blocks further sends', () => {
      const providers = createProviders();
      const host = createTransport(providers.host);
      const sdk = createTransport(providers.sdk);

      const listener = vi.fn<(e: DebugMessageEvent) => void>();
      host.onDebugMessage(listener);

      host.destroy();

      // postMessage on a destroyed transport throws
      expect(() => host.postMessage('after-destroy', samplePayload())).toThrow(/Transport is disposed/);

      // incoming traffic from the peer no longer surfaces to the listener
      sdk.postMessage('in-after-destroy', samplePayload());
      expect(listener).not.toHaveBeenCalled();
    });

    it('does not emit outgoing events when no listener is attached', () => {
      const providers = createProviders();
      const host = createTransport(providers.host);

      // sanity: no listener attached, postMessage works fine
      expect(() => host.postMessage('req', samplePayload())).not.toThrow();

      // attach + detach + send: no events should fire to the (now-detached) listener
      const listener = vi.fn<(e: DebugMessageEvent) => void>();
      const unsubscribe = host.onDebugMessage(listener);
      unsubscribe();

      host.postMessage('req2', samplePayload());
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
