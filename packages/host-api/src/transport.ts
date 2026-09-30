import { enumValue, resultErr, resultOk, toHex } from '@novasamatech/scale';
import type { Emitter } from 'nanoevents';
import { createNanoEvents } from 'nanoevents';

import { HANDSHAKE_INTERVAL, HANDSHAKE_TIMEOUT, SCALE_CODEC_PROTOCOL_ID } from './constants.js';
import { createRequestId, delay, extractErrorMessage, promiseWithResolvers } from './helpers.js';
import type { CallErrorTransportFailure } from './protocol/callError.js';
import { callErrorMarker, isCallErrorMarker } from './protocol/callError.js';
import type {
  InterruptPayload,
  ReceivePayload,
  RequestMethodName,
  RequestPayload,
  ResponsePayload,
  StartPayload,
  SubscriptionMethodName,
  TraitName,
  VersionedProtocolMethod,
  VersionedProtocolRequest,
  VersionedProtocolSubscription,
} from './protocol/impl.js';
import { lookupAddress, resolveMethod } from './protocol/impl.js';
import type { Frame, MessageLeg } from './protocol/messageCodec.js';
import {
  MessageType,
  PROTOCOL_ERROR_METHOD_ID,
  PROTOCOL_ERROR_TRAIT_ID,
  decodeFrame,
  decodeProtocolError,
  encodeFrame,
  encodeUnsupportedMessage,
} from './protocol/messageCodec.js';
import { HandshakeErr } from './protocol/v1/handshake.js';
import type { Provider } from './provider.js';
import type {
  ConnectionStatus,
  DebugMessageEvent,
  DecodedMessage,
  RequestHandler,
  SubscriptionFor,
  SubscriptionHandler,
  Transport,
} from './types.js';

const EMPTY = new Uint8Array(0);

function isConnected(status: ConnectionStatus) {
  return status === 'connected';
}

function isProtocolError(frame: Frame) {
  return frame.traitId === PROTOCOL_ERROR_TRAIT_ID && frame.methodId === PROTOCOL_ERROR_METHOD_ID;
}

function legOf(definition: VersionedProtocolMethod, messageType: number): MessageLeg | undefined {
  if (definition.kind === 'request') {
    switch (messageType) {
      case MessageType.request:
        return 'request';
      case MessageType.response:
        return 'response';
      case MessageType.cancel:
        return 'cancel';
      default:
        return undefined;
    }
  }
  switch (messageType) {
    case MessageType.start:
      return 'start';
    case MessageType.receive:
      return 'receive';
    case MessageType.interrupt:
      return 'interrupt';
    case MessageType.stop:
      return 'stop';
    default:
      return undefined;
  }
}

function decodeLeg(definition: VersionedProtocolMethod, leg: MessageLeg, payload: Uint8Array): unknown {
  switch (leg) {
    case 'request':
      return (definition as VersionedProtocolRequest).request.dec(payload);
    case 'response':
      return (definition as VersionedProtocolRequest).response.dec(payload);
    case 'start':
      return (definition as VersionedProtocolSubscription).start.dec(payload);
    case 'receive':
      return (definition as VersionedProtocolSubscription).receive.dec(payload);
    case 'interrupt':
      return (definition as VersionedProtocolSubscription).interrupt.dec(payload);
    case 'cancel':
    case 'stop':
      return undefined;
  }
}

function describeFrame(frame: Frame, decoded?: () => unknown): DecodedMessage {
  const address = lookupAddress(frame.traitId, frame.methodId);
  const leg = address ? legOf(address.definition, frame.messageType) : undefined;
  let value: unknown;
  if (decoded) {
    value = decoded();
  } else if (address && leg) {
    try {
      value = decodeLeg(address.definition, leg, frame.payload);
    } catch {
      value = undefined;
    }
  }
  return {
    trait: address?.trait,
    method: address?.method,
    traitId: frame.traitId,
    methodId: frame.methodId,
    leg,
    value,
  };
}

// A decoded response/interrupt carrying a transport failure is tagged with the
// first version, since a failure has no version on the wire. Re-tag it with
// the version the call was made in, so callers see the version they spoke.
function retagFailure<V extends { tag: string; value: unknown }>(decoded: V, tag: string): V {
  return isCallErrorMarker(decoded.value) ? ({ ...decoded, tag } as V) : decoded;
}

type InternalListener = {
  unsubscribe: VoidFunction;
  call(payload: any): void;
};

type InternalSubscription = {
  requestId: string;
  kill(): void;
  listeners: InternalListener[];
  interruptEvents: Emitter<{ interrupt: (payload: unknown) => void }>;
  // Set once the host has interrupted. Kept so onInterrupt listeners attached
  // afterwards — including before subscribe() even returned, when an in-process
  // host interrupts synchronously — still see the payload.
  latchedInterrupt?: { payload: unknown };
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

  // inbound frames — decoded once per frame, fanned out to every listener

  const frameListeners = new Set<(frame: Frame) => void>();
  let unsubscribeProvider: VoidFunction | null = null;

  function onFrame(bytes: Uint8Array) {
    let frame: Frame;
    try {
      frame = decodeFrame(bytes);
    } catch (e) {
      provider.logger.error('Transport error: undecodable frame', e);
      return;
    }

    for (const listener of [...frameListeners]) {
      try {
        listener(frame);
      } catch (e) {
        provider.logger.error('Transport error', e);
      }
    }

    // A request-leg frame for an address this build does not know: tell the
    // peer, so its call settles as unsupported instead of hanging.
    if (
      !isProtocolError(frame) &&
      frame.messageType === MessageType.request &&
      !lookupAddress(frame.traitId, frame.methodId)
    ) {
      provider.logger.warn(`Unsupported wire address (${frame.traitId}, ${frame.methodId})`);
      try {
        post({
          requestId: frame.requestId,
          traitId: PROTOCOL_ERROR_TRAIT_ID,
          methodId: PROTOCOL_ERROR_METHOD_ID,
          messageType: MessageType.response,
          payload: encodeUnsupportedMessage(frame.traitId, frame.methodId),
        });
      } catch (e) {
        provider.logger.error('Transport error: failed to answer an unsupported frame', e);
      }
    }
  }

  function subscribeFrames(listener: (frame: Frame) => void): VoidFunction {
    if (frameListeners.size === 0) {
      unsubscribeProvider = provider.subscribe(onFrame);
    }
    frameListeners.add(listener);

    return () => {
      frameListeners.delete(listener);
      if (frameListeners.size === 0 && unsubscribeProvider) {
        unsubscribeProvider();
        unsubscribeProvider = null;
      }
    };
  }

  // Settles on a protocol error correlated to `requestId` and addressed at the
  // given method (or at nothing this build can read, from a later peer).
  function isProtocolErrorFor(frame: Frame, requestId: string, traitId: number, methodId: number) {
    if (!isProtocolError(frame) || frame.requestId !== requestId) return false;
    try {
      const unsupported = decodeProtocolError(frame.payload);
      return unsupported === null || (unsupported.traitId === traitId && unsupported.methodId === methodId);
    } catch (e) {
      provider.logger.error('Transport error: malformed protocol error', e);
      return false;
    }
  }

  const handshakeAddress = resolveMethod('system', 'handshake');

  function post(frame: Frame, decoded?: () => unknown) {
    throwIfDisposed();
    throwIfIncorrectEnvironment();
    // The handshake is how the codec version gets negotiated, so its frames
    // must flow even once a peer asked for a version we do not speak — that is
    // how the peer learns `UnsupportedProtocolVersion`.
    if (frame.traitId !== handshakeAddress.traitId || frame.methodId !== handshakeAddress.methodId) {
      throwIfInvalidCodecVersion();
    }

    if (debugListenerCount > 0) {
      const payload = describeFrame(frame, decoded);
      events.emit('debugMessage', { direction: 'outgoing', requestId: frame.requestId, payload });
    }

    provider.postMessage(encodeFrame(frame));
  }

  // subscriptions management (multiplexing)
  const activeSubscriptions: Map<string, InternalSubscription> = new Map();

  function sendFailure<T extends TraitName, M extends SubscriptionMethodName<T>>(
    subscription: InternalSubscription,
    tag: string,
    failure: CallErrorTransportFailure,
  ) {
    const payload = { tag, value: callErrorMarker(failure) } as InterruptPayload<T, M>;
    subscription.latchedInterrupt = { payload };
    subscription.interruptEvents.emit('interrupt', payload);
  }

  // Wires a real subscription on the transport; later subscribers with the same
  // start payload join it through `listeners` instead of opening another. The
  // first listener is registered before `start` is posted: an in-process host
  // may send its first value synchronously while handling it.
  function openSubscription<const T extends TraitName, const M extends SubscriptionMethodName<T>>(
    trait: T,
    method: M,
    subscriptionKey: string,
    startPayload: StartPayload<T, M>,
    startBytes: Uint8Array,
    listener: InternalListener,
  ): InternalSubscription {
    const { traitId, methodId, definition } = resolveMethod(trait, method);
    const codecs = definition as unknown as VersionedProtocolSubscription;
    const requestId = createRequestId();
    const startTag = (startPayload as { tag: string }).tag;

    const unsubscribeFrames = subscribeFrames(frame => {
      if (frame.requestId !== requestId) return;

      if (isProtocolErrorFor(frame, requestId, traitId, methodId)) {
        stopSubscription();
        sendFailure(subscription, startTag, { tag: 'Unsupported' });
        return;
      }

      if (frame.traitId !== traitId || frame.methodId !== methodId) return;

      switch (frame.messageType) {
        case MessageType.receive: {
          const value = codecs.receive.dec(frame.payload);
          for (const listener of subscription.listeners) {
            try {
              listener.call(value);
            } catch (e) {
              provider.logger.error(`subscription "${trait}.${method}" listener threw`, e);
            }
          }
          return;
        }
        case MessageType.interrupt: {
          // The host has dropped this subscription. Tear it down first so a
          // re-subscribe with the same payload, even from inside onInterrupt,
          // opens a fresh one instead of joining this dead entry.
          stopSubscription();
          let payload: unknown;
          try {
            payload = retagFailure(codecs.interrupt.dec(frame.payload), startTag);
          } catch (e) {
            payload = {
              tag: startTag,
              value: callErrorMarker({ tag: 'MalformedFrame', value: { reason: extractErrorMessage(e) } }),
            };
          }
          subscription.latchedInterrupt = { payload };
          subscription.interruptEvents.emit('interrupt', payload);
          return;
        }
      }
    });

    const stopSubscription = () => {
      activeSubscriptions.delete(subscriptionKey);
      unsubscribeFrames();
    };

    const subscription: InternalSubscription = {
      requestId,
      listeners: [listener],
      interruptEvents: createNanoEvents(),
      kill: () => {
        stopSubscription();
        post({ requestId, traitId, methodId, messageType: MessageType.stop, payload: EMPTY });
      },
    };

    activeSubscriptions.set(subscriptionKey, subscription);
    post({ requestId, traitId, methodId, messageType: MessageType.start, payload: startBytes }, () => startPayload);

    return subscription;
  }

  // Lazy provider subscription — zero per-message decode cost while no
  // debug listener is attached.
  let debugListenerCount = 0;
  let debugFramesUnsubscribe: VoidFunction | null = null;

  function ensureDebugFrameSubscription(): void {
    if (debugFramesUnsubscribe) return;
    debugFramesUnsubscribe = subscribeFrames(frame => {
      events.emit('debugMessage', {
        direction: 'incoming',
        requestId: frame.requestId,
        payload: describeFrame(frame),
      });
    });
  }

  function maybeDisposeDebugFrameSubscription(): void {
    if (debugListenerCount > 0) return;
    debugFramesUnsubscribe?.();
    debugFramesUnsubscribe = null;
  }

  function performHandshake() {
    const { traitId, methodId, definition } = handshakeAddress;
    const request = enumValue('v1', codecVersion);
    const requestBytes = definition.request.enc(request);

    return new Promise<boolean>(resolve => {
      const ids = new Set<string>();
      let settled = false;

      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        clearInterval(interval);
        unsubscribe();
        handshakeAbortController.signal.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const onAbort = () => finish(false);

      const unsubscribe = subscribeFrames(frame => {
        if (!ids.has(frame.requestId)) return;
        if (frame.traitId !== traitId || frame.methodId !== methodId || frame.messageType !== MessageType.response) {
          return;
        }
        const response = definition.response.dec(frame.payload);
        // Only an `Ok` completes the handshake; an `Err` (e.g. an unsupported
        // codec version) means the host will not talk to us.
        finish(!isCallErrorMarker(response.value) && response.value.success);
      });

      handshakeAbortController.signal.addEventListener('abort', onAbort, { once: true });

      const interval = setInterval(() => {
        if (handshakeAbortController.signal.aborted) {
          finish(false);
          return;
        }
        const requestId = createRequestId();
        ids.add(requestId);
        post({ requestId, traitId, methodId, messageType: MessageType.request, payload: requestBytes }, () => request);
      }, HANDSHAKE_INTERVAL);
    });
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

      const timedOutRequest = Promise.race([performHandshake(), delay(HANDSHAKE_TIMEOUT).then(() => false)]).then(
        success => {
          if (!success) {
            handshakeAbortController.abort('Timeout');
          }
          return success;
        },
      );

      handshakePromise = timedOutRequest.then(result => {
        handshakePromise = null;
        connectionStatusResolved = true;
        changeConnectionStatus(result ? 'connected' : 'disconnected');
        return result;
      });

      return handshakePromise;
    },

    async request<const T extends TraitName, const M extends RequestMethodName<T>>(
      trait: T,
      method: M,
      payload: RequestPayload<T, M>,
      signal?: AbortSignal,
    ) {
      checks();

      if (!(await transport.isReady())) {
        throw new Error('Polkadot host is not ready');
      }

      signal?.throwIfAborted();

      const { traitId, methodId, definition } = resolveMethod(trait, method);
      const codecs = definition as unknown as VersionedProtocolRequest;
      const requestId = createRequestId();
      const requestTag = (payload as { tag: string }).tag;

      const { resolve, reject, promise } = promiseWithResolvers<ResponsePayload<T, M>>();

      const cleanup = () => {
        unsubscribe();
        signal?.removeEventListener('abort', onAbort);
      };

      const onAbort = () => {
        cleanup();
        // Withdraw the call so the host can stop working on it. The host still
        // answers (`CallError::Cancelled`), but nobody is listening any more.
        try {
          post({ requestId, traitId, methodId, messageType: MessageType.cancel, payload: EMPTY });
        } catch (e) {
          provider.logger.warn(`request "${trait}.${method}": failed to send cancel`, e);
        }
        reject(signal?.reason ?? new Error('Request aborted'));
      };

      const unsubscribe = subscribeFrames(frame => {
        if (frame.requestId !== requestId) return;

        if (isProtocolErrorFor(frame, requestId, traitId, methodId)) {
          cleanup();
          resolve({ tag: requestTag, value: callErrorMarker({ tag: 'Unsupported' }) } as ResponsePayload<T, M>);
          return;
        }

        if (frame.traitId !== traitId || frame.methodId !== methodId || frame.messageType !== MessageType.response) {
          return;
        }

        cleanup();
        try {
          resolve(retagFailure(codecs.response.dec(frame.payload), requestTag) as ResponsePayload<T, M>);
        } catch (e) {
          reject(new Error(`Malformed "${trait}.${method}" response: ${extractErrorMessage(e)}`));
        }
      });

      signal?.addEventListener('abort', onAbort, { once: true });

      post(
        {
          requestId,
          traitId,
          methodId,
          messageType: MessageType.request,
          payload: codecs.request.enc(payload as never),
        },
        () => payload,
      );

      return promise;
    },

    handleRequest<const T extends TraitName, const M extends RequestMethodName<T>>(
      trait: T,
      method: M,
      handler: RequestHandler<T, M>,
    ) {
      checks();

      const { traitId, methodId, definition } = resolveMethod(trait, method);
      const codecs = definition as unknown as VersionedProtocolRequest;
      const [fallbackTag = 'v1'] = codecs.tags;

      // In-flight calls by request id, so a `Cancel` can reach its handler.
      const inFlight = new Map<string, { controller: AbortController; tag: string }>();

      const respond = (requestId: string, response: unknown) => {
        let payload: Uint8Array;
        try {
          payload = codecs.response.enc(response as never);
        } catch (e) {
          // A handler answered with a value its codec cannot encode. Tell the
          // caller the host failed rather than leaving the call unanswered.
          provider.logger.error(`handleRequest: "${trait}.${method}" answered a value that does not encode`, e);
          const tag = (response as { tag?: string } | undefined)?.tag ?? fallbackTag;
          payload = codecs.response.enc({
            tag,
            value: callErrorMarker({ tag: 'HostFailure', value: { reason: extractErrorMessage(e) } }),
          } as never);
        }
        post({ requestId, traitId, methodId, messageType: MessageType.response, payload }, () => response);
      };

      const respondFailure = (requestId: string, tag: string, failure: CallErrorTransportFailure) => {
        respond(requestId, { tag, value: callErrorMarker(failure) });
      };

      return subscribeFrames(frame => {
        if (frame.traitId !== traitId || frame.methodId !== methodId) return;

        if (frame.messageType === MessageType.cancel) {
          const call = inFlight.get(frame.requestId);
          if (!call) return;
          // Exactly one response per call: answer `Cancelled` now and drop
          // whatever the handler resolves with later.
          inFlight.delete(frame.requestId);
          call.controller.abort(new Error('Request cancelled by the caller'));
          respondFailure(frame.requestId, call.tag, { tag: 'Cancelled' });
          return;
        }

        if (frame.messageType !== MessageType.request) return;

        const { requestId } = frame;
        let params: RequestPayload<T, M>;
        try {
          params = codecs.request.dec(frame.payload) as RequestPayload<T, M>;
        } catch (e) {
          respondFailure(requestId, fallbackTag, {
            tag: 'MalformedFrame',
            value: { reason: extractErrorMessage(e) },
          });
          return;
        }

        const tag = (params as { tag: string }).tag;
        const call = { controller: new AbortController(), tag };
        inFlight.set(requestId, call);

        const isCurrent = () => inFlight.get(requestId) === call;

        Promise.resolve()
          .then(() => handler(params, { signal: call.controller.signal }))
          .then(
            result => {
              if (!isCurrent()) return;
              inFlight.delete(requestId);
              respond(requestId, result);
            },
            (error: unknown) => {
              if (!isCurrent()) return;
              inFlight.delete(requestId);
              provider.logger.error(`handleRequest: handler for "${trait}.${method}" rejected`, error);
              // Answer a transport-level CallError so the caller sees a failed
              // request rather than a hung promise. Domain errors are the
              // handler's job; this is the fallback when the handler itself threw.
              respondFailure(requestId, tag, { tag: 'HostFailure', value: { reason: extractErrorMessage(error) } });
            },
          );
      });
    },

    subscribe<const T extends TraitName, const M extends SubscriptionMethodName<T>>(
      trait: T,
      method: M,
      payload: StartPayload<T, M>,
      callback: (payload: ReceivePayload<T, M>) => void,
    ): SubscriptionFor<T, M> {
      checks();

      type Interrupt = InterruptPayload<T, M>;

      const { traitId, methodId, definition } = resolveMethod(trait, method);
      const startBytes = (definition as unknown as VersionedProtocolSubscription).start.enc(payload as never);
      const subscriptionKey = `${traitId}:${methodId}:${toHex(startBytes)}`;

      function unsubscribeListener() {
        const subscription = activeSubscriptions.get(subscriptionKey);
        if (subscription) {
          const newListeners = subscription.listeners.filter(listener => listener.call !== callback);
          if (newListeners.length === 0) {
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

      const existing = activeSubscriptions.get(subscriptionKey);
      existing?.listeners.push(listener);
      const subscription = existing ?? openSubscription(trait, method, subscriptionKey, payload, startBytes, listener);

      return {
        unsubscribe: unsubscribeListener,
        onInterrupt(callback) {
          if (subscription.latchedInterrupt) {
            callback(subscription.latchedInterrupt.payload as Interrupt);
            return () => {
              /* already delivered */
            };
          }
          return subscription.interruptEvents.on('interrupt', callback as (payload: unknown) => void);
        },
      };
    },

    handleSubscription<const T extends TraitName, const M extends SubscriptionMethodName<T>>(
      trait: T,
      method: M,
      handler: SubscriptionHandler<T, M>,
    ) {
      checks();

      const { traitId, methodId, definition } = resolveMethod(trait, method);
      const codecs = definition as unknown as VersionedProtocolSubscription;

      const subscriptions: Map<string, VoidFunction> = new Map();

      const encodeFailure = (e: unknown) =>
        codecs.interrupt.enc({
          tag: codecs.tags[0] ?? 'v1',
          value: callErrorMarker({ tag: 'HostFailure', value: { reason: extractErrorMessage(e) } }),
        } as never);

      const postInterrupt = (requestId: string, value: unknown) => {
        let payload: Uint8Array;
        try {
          payload = codecs.interrupt.enc(value as never);
        } catch (e) {
          provider.logger.error(
            `handleSubscription: "${trait}.${method}" interrupted with a value that does not encode`,
            e,
          );
          payload = encodeFailure(e);
        }
        post({ requestId, traitId, methodId, messageType: MessageType.interrupt, payload }, () => value);
      };

      const unsubscribeFrames = subscribeFrames(frame => {
        if (frame.traitId !== traitId || frame.methodId !== methodId) return;
        const { requestId } = frame;

        if (frame.messageType === MessageType.stop) {
          const cleanup = subscriptions.get(requestId);
          subscriptions.delete(requestId);
          cleanup?.();
          return;
        }

        if (frame.messageType !== MessageType.start) return;
        if (subscriptions.has(requestId)) return;

        let params: StartPayload<T, M>;
        try {
          params = codecs.start.dec(frame.payload) as StartPayload<T, M>;
        } catch (e) {
          postInterrupt(requestId, {
            tag: codecs.tags[0] ?? 'v1',
            value: callErrorMarker({ tag: 'MalformedFrame', value: { reason: extractErrorMessage(e) } }),
          });
          return;
        }

        let interrupted = false;

        const unsubscribe = handler(
          params,
          value => {
            let payload: Uint8Array;
            try {
              payload = codecs.receive.enc(value as never);
            } catch (e) {
              // An item that does not encode ends the stream: the product
              // would otherwise wait on a value that never arrives.
              provider.logger.error(`handleSubscription: "${trait}.${method}" sent a value that does not encode`, e);
              const cleanup = subscriptions.get(requestId);
              subscriptions.delete(requestId);
              interrupted = true;
              post({
                requestId,
                traitId,
                methodId,
                messageType: MessageType.interrupt,
                payload: encodeFailure(e),
              });
              cleanup?.();
              return;
            }
            post({ requestId, traitId, methodId, messageType: MessageType.receive, payload }, () => value);
          },
          value => {
            interrupted = true;
            // Undefined while the handler is still running; then the handler's
            // own cleanup, which must run since no `stop` will ever arrive.
            const cleanup = subscriptions.get(requestId);
            subscriptions.delete(requestId);
            postInterrupt(requestId, value);
            cleanup?.();
          },
        );

        if (interrupted) {
          unsubscribe();
        } else {
          subscriptions.set(requestId, unsubscribe);
        }
      });

      return () => {
        subscriptions.forEach(unsub => unsub());
        subscriptions.clear();
        unsubscribeFrames();
      };
    },

    postMessage(frame) {
      post(frame);
    },

    listenMessages(callback) {
      return subscribeFrames(callback);
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
      debugFramesUnsubscribe?.();
      debugFramesUnsubscribe = null;
      debugListenerCount = 0;
      frameListeners.clear();
      unsubscribeProvider?.();
      unsubscribeProvider = null;
      provider.dispose();
      changeConnectionStatus('disconnected');
      events.emit('destroy');
      events.events = {};
      handshakeAbortController.abort('Transport disposed');
    },

    onDebugMessage(callback) {
      debugListenerCount++;
      ensureDebugFrameSubscription();
      // Wrap each listener individually: nanoevents iterates listeners
      // synchronously and a throw aborts the loop, so without per-listener
      // isolation a single broken listener could starve siblings *and*
      // (on the incoming side) starve unrelated frame listeners.
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
        maybeDisposeDebugFrameSubscription();
      };
    },
  };

  if (provider.isCorrectEnvironment()) {
    transport.handleRequest('system', 'handshake', async version => {
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
