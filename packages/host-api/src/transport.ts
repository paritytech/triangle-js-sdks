import { enumValue, isEnumVariant, resultErr, resultOk, toHex } from '@novasamatech/scale';
import { createNanoEvents } from 'nanoevents';
import type { CodecType } from 'scale-ts';

import { HANDSHAKE_INTERVAL, HANDSHAKE_TIMEOUT, SCALE_CODEC_PROTOCOL_ID } from './constants.js';
import { composeAction, createRequestId, delay, promiseWithResolvers } from './helpers.js';
import type {
  ComposeMessageAction,
  MessageAction,
  MessagePayloadSchema,
  PickMessagePayload,
  PickMessagePayloadValue,
} from './protocol/messageCodec.js';
import { Message, MessagePayload } from './protocol/messageCodec.js';
import { HandshakeErr } from './protocol/v1/handshake.js';
import type { Provider } from './provider.js';
import type {
  ConnectionStatus,
  DebugMessageEvent,
  HostApiMethod,
  MessageProvider,
  RequestHandler,
  SubscriptionFor,
  SubscriptionHandler,
  Transport,
} from './types.js';

function isConnected(status: ConnectionStatus) {
  return status === 'connected';
}

function getSubscriptionKey(method: string, payload: MessagePayloadSchema) {
  return `${method}_${toHex(MessagePayload.enc(payload))}`;
}

function createMessageProvider(provider: Provider): MessageProvider {
  const subscribers = new Set<(message: CodecType<typeof Message>) => void>();
  let unsubscribeProvider: VoidFunction | null = null;

  return {
    postMessage(message) {
      provider.postMessage(Message.enc(message));
    },
    subscribe(fn) {
      if (subscribers.size === 0) {
        unsubscribeProvider = provider.subscribe(payload => {
          try {
            const message = Message.dec(payload);
            for (const subscriber of subscribers) {
              subscriber(message);
            }
          } catch (e) {
            provider.logger.error('Transport error', e);
          }
        });
      }

      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);

        if (subscribers.size === 0 && unsubscribeProvider) {
          unsubscribeProvider();
          unsubscribeProvider = null;
        }
      };
    },
  };
}

type InternalListener = {
  unsubscribe: VoidFunction;
  call(payload: any): void;
};

type InternalSubscription = {
  requestId: string;
  kill(): void;
  listeners: InternalListener[];
};

export function createTransport(provider: Provider): Transport {
  let codecVersion = SCALE_CODEC_PROTOCOL_ID;

  const handshakeAbortController = new AbortController();

  let handshakePromise: Promise<boolean> | null = null;
  let connectionStatusResolved = false;
  let connectionStatus: ConnectionStatus = 'disconnected';
  let disposed = false;

  const events = createNanoEvents<{
    connectionStatus: (status: ConnectionStatus) => void;
    debugMessage: (m: DebugMessageEvent) => void;
    destroy: VoidFunction;
  }>();

  events.on('connectionStatus', value => {
    connectionStatus = value;
  });

  function changeConnectionStatus(status: ConnectionStatus) {
    events.emit('connectionStatus', status);
  }

  function throwIfDisposed() {
    if (disposed) {
      throw new Error('Transport is disposed');
    }
  }

  function throwIfIncorrectEnvironment() {
    if (!provider.isCorrectEnvironment()) {
      throw new Error('Environment is not correct');
    }
  }

  function throwIfInvalidCodecVersion() {
    if (codecVersion !== SCALE_CODEC_PROTOCOL_ID) {
      throw new Error(`Unsupported codec version: ${codecVersion}`);
    }
  }

  function checks() {
    throwIfDisposed();
    throwIfIncorrectEnvironment();
    throwIfInvalidCodecVersion();
  }

  const messageProvider = createMessageProvider(provider);

  // subscriptions management (multiplexing)
  const activeSubscriptions: Map<string, InternalSubscription> = new Map();

  // Lazy provider subscription — zero per-message decode cost while no
  // debug listener is attached.
  let debugListenerCount = 0;
  let debugProviderUnsubscribe: VoidFunction | null = null;

  function ensureDebugProviderSubscription(): void {
    if (debugProviderUnsubscribe) return;
    debugProviderUnsubscribe = messageProvider.subscribe(message => {
      events.emit('debugMessage', {
        direction: 'incoming',
        requestId: message.requestId,
        payload: message.payload,
      });
    });
  }

  function maybeDisposeDebugProviderSubscription(): void {
    if (debugListenerCount > 0) return;
    debugProviderUnsubscribe?.();
    debugProviderUnsubscribe = null;
  }

  const transport: Transport = {
    provider,

    isCorrectEnvironment() {
      return provider.isCorrectEnvironment();
    },

    isReady() {
      checks();

      if (connectionStatusResolved) {
        return Promise.resolve(isConnected(connectionStatus));
      }

      if (handshakePromise) {
        return handshakePromise;
      }

      changeConnectionStatus('connecting');

      const performHandshake = () => {
        const id = createRequestId();
        let resolved = false;

        const cleanup = (interval: ReturnType<typeof setInterval>, unsubscribe: VoidFunction) => {
          clearInterval(interval);
          unsubscribe();
          handshakeAbortController.signal.removeEventListener('abort', unsubscribe);
        };

        return new Promise<boolean>(resolve => {
          const unsubscribe = transport.listenMessages('host_handshake_response', responseId => {
            if (responseId === id) {
              cleanup(interval, unsubscribe);
              resolved = true;
              resolve(true);
            }
          });

          handshakeAbortController.signal.addEventListener('abort', unsubscribe, { once: true });

          const interval = setInterval(() => {
            if (handshakeAbortController.signal.aborted) {
              clearInterval(interval);
              resolve(false);
              return;
            }

            transport.postMessage(id, enumValue('host_handshake_request', enumValue('v1', codecVersion)));
          }, HANDSHAKE_INTERVAL);
        }).then(success => {
          if (!success && !resolved) {
            handshakeAbortController.abort('Timeout');
          }
          return success;
        });
      };

      const timedOutRequest = Promise.race([performHandshake(), delay(HANDSHAKE_TIMEOUT).then(() => false)]);

      handshakePromise = timedOutRequest.then(result => {
        handshakePromise = null;
        connectionStatusResolved = true;
        changeConnectionStatus(result ? 'connected' : 'disconnected');
        return result;
      });

      return handshakePromise;
    },

    async request<const Method extends HostApiMethod>(
      method: Method,
      payload: PickMessagePayloadValue<ComposeMessageAction<Method, 'request'>>,
      signal?: AbortSignal,
    ) {
      checks();

      if (!(await transport.isReady())) {
        throw new Error('Polkadot host is not ready');
      }

      signal?.throwIfAborted();

      const requestId = createRequestId();
      const requestAction = composeAction(method, 'request');
      const responseAction = composeAction(method, 'response');

      const { resolve, reject, promise } =
        promiseWithResolvers<PickMessagePayloadValue<ComposeMessageAction<Method, 'response'>>>();

      const cleanup = () => {
        unsubscribe();
        signal?.removeEventListener('abort', onAbort);
      };

      const onAbort = () => {
        cleanup();
        reject(signal?.reason ?? new Error('Request aborted'));
      };

      const unsubscribe = transport.listenMessages(responseAction, (receivedId, payload) => {
        if (receivedId === requestId) {
          cleanup();
          resolve(payload.value as PickMessagePayloadValue<ComposeMessageAction<Method, 'response'>>);
        }
      });

      signal?.addEventListener('abort', onAbort, { once: true });

      const requestMessage = enumValue(requestAction, payload) as never as PickMessagePayload<
        ComposeMessageAction<Method, 'request'>
      >;

      transport.postMessage(requestId, requestMessage);

      return promise;
    },

    handleRequest<const Method extends HostApiMethod>(method: Method, handler: RequestHandler<Method>) {
      checks();

      const requestAction = composeAction(method, 'request');
      const responseAction = composeAction(method, 'response');

      return transport.listenMessages(requestAction, (requestId, payload) => {
        handler(payload.value as never).then(
          result => {
            const responseMessage = enumValue(responseAction, result) as never as PickMessagePayload<
              ComposeMessageAction<Method, 'response'>
            >;

            transport.postMessage(requestId, responseMessage);
          },
          (error: unknown) => {
            provider.logger.error(`handleRequest: handler for "${method}" rejected`, error);
          },
        );
      });
    },

    subscribe<const Method extends HostApiMethod>(
      method: Method,
      payload: PickMessagePayloadValue<ComposeMessageAction<Method, 'start'>>,
      callback: (payload: PickMessagePayloadValue<ComposeMessageAction<Method, 'receive'>>) => void,
    ): SubscriptionFor<Method> {
      checks();

      type InterruptPayload = PickMessagePayloadValue<ComposeMessageAction<Method, 'interrupt'>>;
      const events = createNanoEvents<{ interrupt: (payload: InterruptPayload) => void }>();

      const startAction = composeAction(method, 'start');
      const startPayload = enumValue(startAction, payload) as never as PickMessagePayload<
        ComposeMessageAction<Method, 'start'>
      >;

      const subscriptionKey = getSubscriptionKey(method, startPayload);
      let subscription = activeSubscriptions.get(subscriptionKey);

      function unsubscribeListener() {
        const subscription = activeSubscriptions.get(subscriptionKey);
        if (subscription) {
          const newListeners = subscription.listeners.filter(listener => listener.call !== callback);
          if (newListeners.length === 0) {
            activeSubscriptions.delete(subscriptionKey);
            subscription.kill();
          } else {
            subscription.listeners = newListeners;
          }
        }
      }

      const listener: InternalListener = {
        call: callback,
        unsubscribe: unsubscribeListener,
      };

      const publicSubscription: SubscriptionFor<Method> = {
        unsubscribe: unsubscribeListener,
        onInterrupt(callback) {
          return events.on('interrupt', callback);
        },
      };

      // wiring up a real subscription
      if (!subscription) {
        const requestId = createRequestId();

        const stopAction = composeAction(method, 'stop');
        const interruptAction = composeAction(method, 'interrupt');
        const receiveAction = composeAction(method, 'receive');

        const unsubscribeReceive = transport.listenMessages(receiveAction, (receivedId, data) => {
          if (receivedId === requestId) {
            const subscription = activeSubscriptions.get(subscriptionKey);
            if (subscription) {
              for (const listener of subscription.listeners) {
                listener.call(data.value);
              }
            }
          }
        });

        const unsubscribeInterrupt = transport.listenMessages(interruptAction, (receivedId, data) => {
          if (receivedId === requestId) {
            events.emit('interrupt', data.value as InterruptPayload);
            stopSubscription();
          }
        });

        const stopSubscription = () => {
          unsubscribeReceive();
          unsubscribeInterrupt();
          events.events = {};
        };

        // creating subscription

        subscription = {
          requestId,
          kill: () => {
            stopSubscription();

            const stopPayload = enumValue(stopAction, undefined) as PickMessagePayload<
              ComposeMessageAction<Method, 'stop'>
            >;

            transport.postMessage(requestId, stopPayload);
          },
          listeners: [listener],
        };

        activeSubscriptions.set(subscriptionKey, subscription);

        transport.postMessage(requestId, startPayload);
      } else {
        subscription.listeners.push(listener);
      }

      return publicSubscription;
    },

    handleSubscription<const Method extends HostApiMethod>(method: Method, handler: SubscriptionHandler<Method>) {
      checks();

      const startAction = composeAction(method, 'start');
      const stopAction = composeAction(method, 'stop');
      const interruptAction = composeAction(method, 'interrupt');
      const receiveAction = composeAction(method, 'receive');

      const subscriptions: Map<string, VoidFunction> = new Map();

      const unsubStart = transport.listenMessages(startAction, (requestId, payload) => {
        if (subscriptions.has(requestId)) return;
        let interrupted = false;

        const unsubscribe = handler(
          payload.value as never,
          value => {
            const receivePayload = enumValue(receiveAction, value) as never as PickMessagePayload<
              ComposeMessageAction<Method, 'receive'>
            >;
            transport.postMessage(requestId, receivePayload);
          },
          value => {
            interrupted = true;
            subscriptions.delete(requestId);
            transport.postMessage(
              requestId,
              enumValue(interruptAction, value) as never as PickMessagePayload<
                ComposeMessageAction<Method, 'interrupt'>
              >,
            );
          },
        );

        if (interrupted) {
          unsubscribe();
        } else {
          subscriptions.set(requestId, unsubscribe);
        }
      });

      const unsubStop = transport.listenMessages(stopAction, requestId => {
        subscriptions.get(requestId)?.();
      });

      return () => {
        subscriptions.forEach(unsub => unsub());
        unsubStart();
        unsubStop();
      };
    },

    postMessage(requestId, payload) {
      checks();

      if (debugListenerCount > 0) {
        events.emit('debugMessage', { direction: 'outgoing', requestId, payload });
      }

      messageProvider.postMessage({ requestId, payload });
    },

    listenMessages<const Action extends MessageAction>(
      action: Action,
      callback: (requestId: string, data: PickMessagePayload<Action>) => void,
      onError?: (error: unknown) => void,
    ) {
      return messageProvider.subscribe(message => {
        try {
          if (isEnumVariant(message.payload, action)) {
            callback(message.requestId, message.payload as PickMessagePayload<Action>);
          }
        } catch (e) {
          onError?.(e);
        }
      });
    },

    onConnectionStatusChange(callback: (status: ConnectionStatus) => void) {
      callback(connectionStatus);

      return events.on('connectionStatus', callback);
    },

    onDestroy(callback) {
      return events.on('destroy', callback);
    },

    destroy() {
      disposed = true;
      debugProviderUnsubscribe?.();
      debugProviderUnsubscribe = null;
      debugListenerCount = 0;
      provider.dispose();
      changeConnectionStatus('disconnected');
      events.emit('destroy');
      events.events = {};
      handshakeAbortController.abort('Transport disposed');
    },
    onDebugMessage(callback) {
      debugListenerCount++;
      ensureDebugProviderSubscription();
      // Wrap each listener individually: nanoevents iterates listeners
      // synchronously and a throw aborts the loop, so without per-listener
      // isolation a single broken listener could starve siblings *and*
      // (on the incoming side) starve unrelated messageProvider subscribers.
      // Route to console.error (not provider.logger.error) so debug-callback
      // bugs stay distinct from real protocol errors — matches the same
      // policy used by host-papp's debugBus.
      const safeCallback = (event: DebugMessageEvent) => {
        try {
          callback(event);
        } catch (e) {
          console.error('debug listener threw', e);
        }
      };
      const unsubscribe = events.on('debugMessage', safeCallback);
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        unsubscribe();
        debugListenerCount--;
        maybeDisposeDebugProviderSubscription();
      };
    },
  };

  if (provider.isCorrectEnvironment()) {
    transport.handleRequest('host_handshake', async version => {
      switch (version.tag) {
        case 'v1': {
          codecVersion = version.value;

          switch (version.value) {
            case SCALE_CODEC_PROTOCOL_ID:
              return enumValue(version.tag, resultOk(undefined));
            default:
              return enumValue(version.tag, resultErr(new HandshakeErr.UnsupportedProtocolVersion(undefined)));
          }
        }
        default:
          return enumValue(version.tag, resultErr(new HandshakeErr.UnsupportedProtocolVersion(undefined)));
      }
    });
  }

  return transport;
}
