import { enumValue, fromHex, resultErr, resultOk, toHex } from '@novasamatech/scale';
import { createNanoEvents } from 'nanoevents';
import { describe, expect, it, vi } from 'vitest';

import { SCALE_CODEC_PROTOCOL_ID } from './constants.js';
import { promiseWithResolvers } from './helpers.js';
import { createDefaultLogger } from './logger.js';
import { CALL_ERROR_FAILURE } from './protocol/callError.js';
import { hostApiProtocol } from './protocol/impl.js';
import type { Frame } from './protocol/messageCodec.js';
import {
  MessageType,
  PROTOCOL_ERROR_METHOD_ID,
  PROTOCOL_ERROR_TRAIT_ID,
  decodeFrame,
  encodeFrame,
} from './protocol/messageCodec.js';
import { HandshakeErr } from './protocol/v1/handshake.js';
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

const handshakeRequest = () => enumValue('v1', SCALE_CODEC_PROTOCOL_ID);

// A `system.handshake` request frame, the simplest frame both sides understand.
const sampleFrame = (requestId: string): Frame => ({
  requestId,
  traitId: hostApiProtocol.system.id,
  methodId: hostApiProtocol.system.methods.handshake.id,
  messageType: MessageType.request,
  payload: hostApiProtocol.system.methods.handshake.request.enc(handshakeRequest()),
});

const isHandshakeRequest = (frame: Frame) =>
  frame.traitId === hostApiProtocol.system.id &&
  frame.methodId === hostApiProtocol.system.methods.handshake.id &&
  frame.messageType === MessageType.request;

const onHandshakeRequest = (callback: (frame: Frame) => void) => (frame: Frame) => {
  if (isHandshakeRequest(frame)) callback(frame);
};

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

      host.handleSubscription('account', 'connectionStatusSubscribe', containerHandler);

      const s1Handler = vi.fn();
      const s1 = sdk.subscribe('account', 'connectionStatusSubscribe', { tag: 'v1', value: undefined }, s1Handler);

      const s2Handler = vi.fn();
      const s2 = sdk.subscribe('account', 'connectionStatusSubscribe', { tag: 'v1', value: undefined }, s2Handler);

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

    it('starts a fresh host subscription when re-subscribing with the same payload after an interrupt', () => {
      const providers = createProviders();
      const events = createNanoEvents<{ push: VoidFunction; interrupt: VoidFunction }>();

      const host = createTransport(providers.host);
      const sdk = createTransport(providers.sdk);

      const containerHandler = vi.fn((_, send, interrupt) => {
        const unsubPush = events.on('push', () => send({ tag: 'v1', value: 'connected' }));
        const unsubInterrupt = events.on('interrupt', () => interrupt({ tag: 'v1', value: undefined }));
        return () => {
          unsubPush();
          unsubInterrupt();
        };
      });
      host.handleSubscription('account', 'connectionStatusSubscribe', containerHandler);

      const first = vi.fn();
      sdk.subscribe('account', 'connectionStatusSubscribe', { tag: 'v1', value: undefined }, first);
      expect(containerHandler).toHaveBeenCalledTimes(1);

      events.emit('interrupt');

      const second = vi.fn();
      sdk.subscribe('account', 'connectionStatusSubscribe', { tag: 'v1', value: undefined }, second);

      // The interrupted subscription is gone: the second subscribe must open a
      // new one on the host rather than joining the dead entry.
      expect(containerHandler).toHaveBeenCalledTimes(2);

      events.emit('push');
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('delivers an interrupt raised synchronously from the host handler to a later onInterrupt listener', () => {
      const providers = createProviders();

      const host = createTransport(providers.host);
      const sdk = createTransport(providers.sdk);

      host.handleSubscription('account', 'connectionStatusSubscribe', (_, _send, interrupt) => {
        interrupt({ tag: 'v1', value: undefined });
        return vi.fn();
      });

      const subscription = sdk.subscribe(
        'account',
        'connectionStatusSubscribe',
        { tag: 'v1', value: undefined },
        vi.fn(),
      );

      // With an in-process host the interrupt arrives before subscribe() has
      // returned, so onInterrupt is necessarily attached afterwards.
      const interrupted = vi.fn();
      subscription.onInterrupt(interrupted);

      expect(interrupted).toHaveBeenCalledExactlyOnceWith({ tag: 'v1', value: undefined });
    });

    it('delivers an interrupt to every subscriber sharing a multiplexed subscription', () => {
      const providers = createProviders();
      const events = createNanoEvents<{ interrupt: VoidFunction }>();

      const host = createTransport(providers.host);
      const sdk = createTransport(providers.sdk);

      host.handleSubscription('account', 'connectionStatusSubscribe', (_, _send, interrupt) =>
        events.on('interrupt', () => interrupt({ tag: 'v1', value: undefined })),
      );

      const first = vi.fn();
      const second = vi.fn();
      sdk
        .subscribe('account', 'connectionStatusSubscribe', { tag: 'v1', value: undefined }, vi.fn())
        .onInterrupt(first);
      sdk
        .subscribe('account', 'connectionStatusSubscribe', { tag: 'v1', value: undefined }, vi.fn())
        .onInterrupt(second);

      events.emit('interrupt');

      expect(first).toHaveBeenCalledExactlyOnceWith({ tag: 'v1', value: undefined });
      expect(second).toHaveBeenCalledExactlyOnceWith({ tag: 'v1', value: undefined });
    });

    it('delivers a later interrupt to a listener attached before it', () => {
      const providers = createProviders();
      const events = createNanoEvents<{ interrupt: VoidFunction }>();

      const host = createTransport(providers.host);
      const sdk = createTransport(providers.sdk);

      host.handleSubscription('account', 'connectionStatusSubscribe', (_, _send, interrupt) =>
        events.on('interrupt', () => interrupt({ tag: 'v1', value: undefined })),
      );

      const interrupted = vi.fn();
      sdk
        .subscribe('account', 'connectionStatusSubscribe', { tag: 'v1', value: undefined }, vi.fn())
        .onInterrupt(interrupted);

      events.emit('interrupt');

      expect(interrupted).toHaveBeenCalledExactlyOnceWith({ tag: 'v1', value: undefined });
    });

    it('drops receive frames and makes unsubscribe a no-op once interrupted', () => {
      const providers = createProviders();
      const events = createNanoEvents<{ interrupt: VoidFunction; push: VoidFunction }>();

      const host = createTransport(providers.host);
      const sdk = createTransport(providers.sdk);

      const hostCleanup = vi.fn();
      host.handleSubscription('account', 'connectionStatusSubscribe', (_, send, interrupt) => {
        events.on('interrupt', () => interrupt({ tag: 'v1', value: undefined }));
        events.on('push', () => send({ tag: 'v1', value: 'connected' }));
        return hostCleanup;
      });

      const callback = vi.fn();
      const subscription = sdk.subscribe(
        'account',
        'connectionStatusSubscribe',
        { tag: 'v1', value: undefined },
        callback,
      );

      events.emit('interrupt');
      // The host-side handler is already torn down by the interrupt itself.
      expect(hostCleanup).toHaveBeenCalledTimes(1);

      events.emit('push');
      expect(callback).not.toHaveBeenCalled();

      // Nothing is left to stop on the host, so no second cleanup.
      subscription.unsubscribe();
      expect(hostCleanup).toHaveBeenCalledTimes(1);
    });

    it('opens a fresh host subscription when re-subscribing from inside onInterrupt', () => {
      const providers = createProviders();
      const events = createNanoEvents<{ interrupt: VoidFunction; push: VoidFunction }>();

      const host = createTransport(providers.host);
      const sdk = createTransport(providers.sdk);

      const containerHandler = vi.fn((_, send, interrupt) => {
        events.on('interrupt', () => interrupt({ tag: 'v1', value: undefined }));
        return events.on('push', () => send({ tag: 'v1', value: 'connected' }));
      });
      host.handleSubscription('account', 'connectionStatusSubscribe', containerHandler);

      const retried = vi.fn();
      sdk
        .subscribe('account', 'connectionStatusSubscribe', { tag: 'v1', value: undefined }, vi.fn())
        .onInterrupt(() => {
          sdk.subscribe('account', 'connectionStatusSubscribe', { tag: 'v1', value: undefined }, retried);
        });

      events.emit('interrupt');
      expect(containerHandler).toHaveBeenCalledTimes(2);

      events.emit('push');
      expect(retried).toHaveBeenCalledTimes(1);
    });

    it('delivers a value the host sends synchronously while handling start', () => {
      const providers = createProviders();

      const host = createTransport(providers.host);
      const sdk = createTransport(providers.sdk);

      host.handleSubscription('account', 'connectionStatusSubscribe', (_, send) => {
        send({ tag: 'v1', value: 'connected' });
        return vi.fn();
      });

      const callback = vi.fn();
      sdk.subscribe('account', 'connectionStatusSubscribe', { tag: 'v1', value: undefined }, callback);

      expect(callback).toHaveBeenCalledExactlyOnceWith({ tag: 'v1', value: 'connected' });
    });

    it('isolates a throwing subscriber so siblings on the same subscription still receive', () => {
      const providers = createProviders();
      const events = createNanoEvents<{ push: VoidFunction }>();

      const host = createTransport(providers.host);
      const sdk = createTransport(providers.sdk);

      host.handleSubscription('account', 'connectionStatusSubscribe', (_, send) =>
        events.on('push', () => send({ tag: 'v1', value: 'connected' })),
      );

      const throwing = vi.fn(() => {
        throw new Error('subscriber boom');
      });
      const healthy = vi.fn();
      sdk.subscribe('account', 'connectionStatusSubscribe', { tag: 'v1', value: undefined }, throwing);
      sdk.subscribe('account', 'connectionStatusSubscribe', { tag: 'v1', value: undefined }, healthy);

      // A throw in the first subscriber must neither escape the dispatch nor
      // starve the second subscriber on the same subscription.
      expect(() => events.emit('push')).not.toThrow();
      expect(throwing).toHaveBeenCalledTimes(1);
      expect(healthy).toHaveBeenCalledTimes(1);
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
      sdk.listenMessages(onHandshakeRequest(sdkReceived));

      const requestId = 'req-1';
      host.postMessage(sampleFrame(requestId));

      expect(debugListener).toHaveBeenCalledTimes(1);
      expect(debugListener).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'outgoing',
          requestId,
          payload: expect.objectContaining({
            trait: 'system',
            method: 'handshake',
            leg: 'request',
            value: handshakeRequest(),
          }),
        }),
      );
      expect(sdkReceived).toHaveBeenCalledTimes(1);
      expect(sdkReceived).toHaveBeenCalledWith(expect.objectContaining({ requestId, traitId: 1, methodId: 0 }));
    });

    it('emits incoming events with decoded payload', () => {
      const providers = createProviders();
      const host = createTransport(providers.host);
      const sdk = createTransport(providers.sdk);

      const debugListener = vi.fn<(e: DebugMessageEvent) => void>();
      host.onDebugMessage(debugListener);

      const requestId = 'req-2';
      sdk.postMessage(sampleFrame(requestId));

      // host receives sdk's message, plus host's own outgoing handshake
      // attempts (none yet, since isReady() wasn't called). Filter to incoming.
      const incoming = debugListener.mock.calls.map(([event]) => event).filter(e => e.direction === 'incoming');

      expect(incoming).toHaveLength(1);
      expect(incoming[0]).toEqual(
        expect.objectContaining({
          direction: 'incoming',
          requestId,
          payload: expect.objectContaining({
            trait: 'system',
            method: 'handshake',
            leg: 'request',
            value: handshakeRequest(),
          }),
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

      host.postMessage(sampleFrame('req-a'));
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);

      unsubscribeA();
      // calling unsubscribe twice must be a no-op
      unsubscribeA();

      host.postMessage(sampleFrame('req-b'));
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
        sdk.listenMessages(onHandshakeRequest(sdkReceived));

        // outgoing: a throwing listener must not block messageProvider.postMessage
        host.postMessage(sampleFrame('out-1'));
        expect(sdkReceived).toHaveBeenCalledTimes(1);

        // incoming: a throwing listener must not block other host listenMessages subscribers
        const hostReceived = vi.fn();
        host.listenMessages(onHandshakeRequest(hostReceived));
        sdk.postMessage(sampleFrame('in-1'));
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
      expect(() => host.postMessage(sampleFrame('after-destroy'))).toThrow(/Transport is disposed/);

      // incoming traffic from the peer no longer surfaces to the listener
      sdk.postMessage(sampleFrame('in-after-destroy'));
      expect(listener).not.toHaveBeenCalled();
    });

    it('does not emit outgoing events when no listener is attached', () => {
      const providers = createProviders();
      const host = createTransport(providers.host);

      // sanity: no listener attached, postMessage works fine
      expect(() => host.postMessage(sampleFrame('req'))).not.toThrow();

      // attach + detach + send: no events should fire to the (now-detached) listener
      const listener = vi.fn<(e: DebugMessageEvent) => void>();
      const unsubscribe = host.onDebugMessage(listener);
      unsubscribe();

      host.postMessage(sampleFrame('req2'));
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('codec 3 wire', () => {
    it('handshakes with codec version 3 and connects', async () => {
      const providers = createProviders();
      createTransport(providers.host);
      const sdk = createTransport(providers.sdk);

      const sent: Frame[] = [];
      sdk.onDebugMessage(event => {
        if (event.direction === 'outgoing' && event.payload.method === 'handshake') {
          sent.push(event.payload as never);
        }
      });

      await expect(sdk.isReady()).resolves.toBe(true);
      expect(sent[0]).toMatchObject({ trait: 'system', leg: 'request', value: { tag: 'v1', value: 3 } });
    });

    it('stays disconnected when the host refuses the codec version', async () => {
      const providers = createProviders();
      // A host answering every handshake with `UnsupportedProtocolVersion`.
      const handshake = hostApiProtocol.system.methods.handshake;
      providers.host.subscribe(bytes => {
        const frame = decodeFrame(bytes);
        providers.host.postMessage(
          encodeFrame({
            ...frame,
            messageType: MessageType.response,
            payload: handshake.response.enc(
              enumValue('v1', resultErr(new HandshakeErr.UnsupportedProtocolVersion(undefined))),
            ),
          }),
        );
      });
      const sdk = createTransport(providers.sdk);

      await expect(sdk.isReady()).resolves.toBe(false);
    });

    it('answers MalformedFrame to a request that does not decode', async () => {
      const providers = createProviders();
      const host = createTransport(providers.host);
      host.handleRequest('localStorage', 'read', vi.fn());

      const answers: Frame[] = [];
      providers.sdk.subscribe(bytes => answers.push(decodeFrame(bytes)));
      // localStorage.read with an unknown version tag (0x07).
      providers.sdk.postMessage(
        encodeFrame({
          requestId: 'r',
          traitId: 7,
          methodId: 0,
          messageType: MessageType.request,
          payload: fromHex('0x07'),
        }),
      );
      await Promise.resolve();

      expect(answers).toHaveLength(1);
      expect(answers[0]).toMatchObject({ requestId: 'r', traitId: 7, methodId: 0, messageType: MessageType.response });
      expect(hostApiProtocol.localStorage.methods.read.response.dec(answers[0]!.payload).value).toMatchObject({
        [CALL_ERROR_FAILURE]: { tag: 'MalformedFrame' },
      });
    });

    it('answers a protocol error for an address it does not know', () => {
      const providers = createProviders();
      createTransport(providers.host);

      const answers: Frame[] = [];
      providers.sdk.subscribe(bytes => answers.push(decodeFrame(bytes)));
      providers.sdk.postMessage(
        encodeFrame({
          requestId: 'r',
          traitId: 200,
          methodId: 9,
          messageType: MessageType.request,
          payload: fromHex('0x00'),
        }),
      );

      expect(answers).toEqual([
        {
          requestId: 'r',
          traitId: PROTOCOL_ERROR_TRAIT_ID,
          methodId: PROTOCOL_ERROR_METHOD_ID,
          messageType: MessageType.response,
          payload: fromHex('0x0000c809'),
        },
      ]);
    });

    it('settles a request as Unsupported on a matching protocol error', async () => {
      const providers = createProviders();
      const host = createTransport(providers.host);
      const sdk = createTransport(providers.sdk);
      await sdk.isReady();

      // The host drops contacts.pick with a protocol error, as a peer that
      // does not implement it would.
      host.listenMessages(frame => {
        if (frame.traitId !== 20) return;
        host.postMessage({
          requestId: frame.requestId,
          traitId: PROTOCOL_ERROR_TRAIT_ID,
          methodId: PROTOCOL_ERROR_METHOD_ID,
          messageType: MessageType.response,
          payload: fromHex('0x00001400'),
        });
      });

      await expect(sdk.request('contacts', 'pick', { tag: 'v1', value: {} })).resolves.toEqual({
        tag: 'v1',
        value: { [CALL_ERROR_FAILURE]: { tag: 'Unsupported' } },
      });
    });

    it('withdraws an aborted request with a Cancel frame and answers it Cancelled', async () => {
      const providers = createProviders();
      const host = createTransport(providers.host);
      const sdk = createTransport(providers.sdk);
      await sdk.isReady();

      let handlerSignal: AbortSignal | undefined;
      const started = promiseWithResolvers<void>();
      host.handleRequest('contacts', 'pick', (_, { signal }) => {
        handlerSignal = signal;
        started.resolve();
        return new Promise(() => {
          /* never settles on its own */
        });
      });

      const answers: Frame[] = [];
      providers.sdk.subscribe(bytes => answers.push(decodeFrame(bytes)));

      const controller = new AbortController();
      const call = sdk.request('contacts', 'pick', { tag: 'v1', value: {} }, controller.signal);
      await started.promise;

      controller.abort(new Error('user left'));
      await expect(call).rejects.toThrow('user left');

      expect(handlerSignal?.aborted).toBe(true);
      const response = answers.find(frame => frame.traitId === 20 && frame.messageType === MessageType.response);
      expect(response && toHex(response.payload)).toBe('0x0105');
    });

    it('answers HostFailure when a handler resolves with a value that does not encode', async () => {
      const providers = createProviders();
      const host = createTransport(providers.host);
      const sdk = createTransport(providers.sdk);
      await sdk.isReady();

      // Not a 32-byte handle: `Bytes(32)` refuses to encode it.
      host.handleRequest('contacts', 'pick', async () =>
        enumValue('v1', resultOk({ outcome: enumValue('Picked', { handle: { bytes: new Uint8Array(3) } }) })),
      );

      await expect(sdk.request('contacts', 'pick', { tag: 'v1', value: {} })).resolves.toMatchObject({
        tag: 'v1',
        value: { [CALL_ERROR_FAILURE]: { tag: 'HostFailure' } },
      });
    });

    it('ends a subscription with HostFailure when an item does not encode', () => {
      const providers = createProviders();
      const host = createTransport(providers.host);
      const sdk = createTransport(providers.sdk);
      const cleanup = vi.fn();
      host.handleSubscription('pocket', 'listSubscribe', (_, send) => {
        // No `v9` version exists, so the item cannot be encoded.
        send({ tag: 'v9', value: { cards: [] } } as never);
        return cleanup;
      });

      const interrupted = vi.fn();
      const received = vi.fn();
      sdk.subscribe('pocket', 'listSubscribe', { tag: 'v1', value: undefined }, received).onInterrupt(interrupted);

      expect(received).not.toHaveBeenCalled();
      expect(interrupted).toHaveBeenCalledWith(
        expect.objectContaining({ value: { [CALL_ERROR_FAILURE]: expect.objectContaining({ tag: 'HostFailure' }) } }),
      );
      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('sends Stop with an empty payload when the last listener leaves', () => {
      const providers = createProviders();
      const host = createTransport(providers.host);
      const sdk = createTransport(providers.sdk);
      const cleanup = vi.fn();
      host.handleSubscription('theme', 'subscribe', () => cleanup);

      const frames: Frame[] = [];
      providers.host.subscribe(bytes => frames.push(decodeFrame(bytes)));

      sdk.subscribe('theme', 'subscribe', { tag: 'v1', value: undefined }, vi.fn()).unsubscribe();

      expect(frames.map(frame => [frame.traitId, frame.methodId, frame.messageType, frame.payload.length])).toEqual([
        [15, 0, MessageType.start, 1],
        [15, 0, MessageType.stop, 0],
      ]);
      expect(cleanup).toHaveBeenCalledTimes(1);
    });
  });
});
