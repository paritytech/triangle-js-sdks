import { enumValue, isEnumVariant, resultErr, resultOk } from '@novasamatech/scale';
import { createNanoEvents } from 'nanoevents';

import { HANDSHAKE_INTERVAL, HANDSHAKE_TIMEOUT, JAM_CODEC_PROTOCOL_ID } from './constants.js';
import { composeAction, createRequestId, delay, promiseWithResolvers } from './helpers.js';
import type {
  ComposeMessageAction,
  MessageAction,
  PickMessagePayload,
  PickMessagePayloadValue,
} from './protocol/messageCodec.js';
import { Message } from './protocol/messageCodec.js';
import { HandshakeErr } from './protocol/v1/handshake.js';
import type { Provider } from './provider.js';
import type { ConnectionStatus, HostApiMethod, RequestHandler, SubscriptionHandler, Transport } from './types.js';

const isConnected = (status: ConnectionStatus) => status === 'connected';

export function createTransport(provider: Provider): Transport {
  let codecVersion = JAM_CODEC_PROTOCOL_ID;

  const handshakeAbortController = new AbortController();

  let handshakePromise: Promise<boolean> | null = null;
  let connectionStatusResolved = false;
  let connectionStatus: ConnectionStatus = 'disconnected';
  let disposed = false;

  const events = createNanoEvents<{
    connectionStatus: (status: ConnectionStatus) => void;
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
    if (codecVersion !== JAM_CODEC_PROTOCOL_ID) {
      throw new Error(`Unsupported codec version: ${codecVersion}`);
    }
  }

  function checks() {
    throwIfDisposed();
    throwIfIncorrectEnvironment();
    throwIfInvalidCodecVersion();
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

        const cleanup = (interval: NodeJS.Timeout, unsubscribe: VoidFunction) => {
          clearInterval(interval);
          unsubscribe();
          handshakeAbortController.signal.removeEventListener('abort', unsubscribe);
        };

        return new Promise<boolean>(resolve => {
          const unsubscribe = transport.listenMessages('handshake_response', responseId => {
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

            transport.postMessage(id, enumValue('handshake_request', enumValue('v1', codecVersion)));
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
        handler(payload.value as never).then(result => {
          const responseMessage = enumValue(responseAction, result) as never as PickMessagePayload<
            ComposeMessageAction<Method, 'response'>
          >;

          transport.postMessage(requestId, responseMessage);
        });
      });
    },

    subscribe<const Method extends HostApiMethod>(
      method: Method,
      payload: PickMessagePayloadValue<ComposeMessageAction<Method, 'start'>>,
      callback: (payload: PickMessagePayloadValue<ComposeMessageAction<Method, 'receive'>>) => void,
    ) {
      checks();

      const events = createNanoEvents<{ interrupt: VoidFunction }>();

      const requestId = createRequestId();

      const startAction = composeAction(method, 'start');
      const stopAction = composeAction(method, 'stop');
      const interruptAction = composeAction(method, 'interrupt');
      const receiveAction = composeAction(method, 'receive');

      const unsubscribeReceive = transport.listenMessages(receiveAction, (receivedId, data) => {
        if (receivedId === requestId) {
          callback(data.value as PickMessagePayloadValue<ComposeMessageAction<Method, 'receive'>>);
        }
      });

      const unsubscribeInterrupt = transport.listenMessages(interruptAction, receivedId => {
        if (receivedId === requestId) {
          events.emit('interrupt');
          stopSubscription();
        }
      });

      const stopSubscription = () => {
        unsubscribeReceive();
        unsubscribeInterrupt();
        events.events = {};
      };

      const startPayload = enumValue(startAction, payload) as never as PickMessagePayload<
        ComposeMessageAction<Method, 'start'>
      >;

      transport.postMessage(requestId, startPayload);

      return {
        unsubscribe() {
          stopSubscription();

          const stopPayload = enumValue(stopAction, undefined) as PickMessagePayload<
            ComposeMessageAction<Method, 'stop'>
          >;

          transport.postMessage(requestId, stopPayload);
        },
        onInterrupt(callback) {
          return events.on('interrupt', callback);
        },
      };
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

        const unsubscribe = handler(
          payload.value as never,
          value => {
            const receivePayload = enumValue(receiveAction, value) as never as PickMessagePayload<
              ComposeMessageAction<Method, 'receive'>
            >;
            transport.postMessage(requestId, receivePayload);
          },
          () => {
            transport.postMessage(
              requestId,
              enumValue(interruptAction, undefined) as never as PickMessagePayload<
                ComposeMessageAction<Method, 'interrupt'>
              >,
            );
          },
        );

        subscriptions.set(requestId, unsubscribe);
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

      const encoded = Message.enc({ requestId, payload });
      provider.postMessage(encoded);
    },

    listenMessages<const Action extends MessageAction>(
      action: Action,
      callback: (requestId: string, data: PickMessagePayload<Action>) => void,
      onError?: (error: unknown) => void,
    ) {
      return provider.subscribe(message => {
        try {
          const result = Message.dec(message);

          if (isEnumVariant(result.payload, action)) {
            callback(result.requestId, result.payload as PickMessagePayload<Action>);
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
      provider.dispose();
      changeConnectionStatus('disconnected');
      events.emit('destroy');
      events.events = {};
      handshakeAbortController.abort('Transport disposed');
    },
  };

  if (provider.isCorrectEnvironment()) {
    transport.handleRequest('handshake', async version => {
      switch (version.tag) {
        case 'v1': {
          codecVersion = version.value;

          switch (version.value) {
            case JAM_CODEC_PROTOCOL_ID:
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
