import type { CodecType } from 'scale-ts';

import type { HostApiProtocol } from './protocol/impl.js';
import type {
  ComposeMessageAction,
  MessageAction,
  MessagePayloadSchema,
  PickMessagePayload,
  PickMessagePayloadValue,
} from './protocol/messageCodec.js';
import { Message } from './protocol/messageCodec.js';
import type { Provider } from './provider.js';

export type HostApiMethod = keyof HostApiProtocol;

export type Logger = Record<'info' | 'warn' | 'error' | 'log', (...args: unknown[]) => void> & {
  withPrefix(prefix: string): Logger;
};

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type RequestHandler<Method extends string> = (
  message: PickMessagePayloadValue<ComposeMessageAction<Method, 'request'>>,
) => PromiseLike<PickMessagePayloadValue<ComposeMessageAction<Method, 'response'>>>;

export type SubscriptionHandler<Method extends string> = (
  params: PickMessagePayloadValue<ComposeMessageAction<Method, 'start'>>,
  send: (value: PickMessagePayloadValue<ComposeMessageAction<Method, 'receive'>>) => void,
  interrupt: (value: PickMessagePayloadValue<ComposeMessageAction<Method, 'interrupt'>>) => void,
) => VoidFunction;

export type Subscription<InterruptPayload = unknown> = {
  unsubscribe: VoidFunction;
  onInterrupt(callback: (payload: InterruptPayload) => void): VoidFunction;
};

export type SubscriptionFor<Method extends HostApiMethod> = Subscription<
  PickMessagePayloadValue<ComposeMessageAction<Method, 'interrupt'>>
>;

export type MessageProvider = {
  postMessage(message: CodecType<typeof Message>): void;
  subscribe(fn: (message: CodecType<typeof Message>) => void): VoidFunction;
};

/**
 * EXPERIMENTAL. A single message observed on the transport, in its
 * decoded (non-SCALE) form. Intended for host-side introspection.
 */
export type DebugMessageEvent = {
  /** `outgoing` = sent by this side via `postMessage`; `incoming` = received from the peer. */
  direction: 'incoming' | 'outgoing';
  requestId: string;
  payload: MessagePayloadSchema;
};

export type Transport = {
  readonly provider: Provider;

  isCorrectEnvironment(): boolean;
  isReady(): Promise<boolean>;
  destroy(): void;
  onConnectionStatusChange(callback: (status: ConnectionStatus) => void): VoidFunction;
  onDestroy(callback: VoidFunction): VoidFunction;

  request<const Method extends HostApiMethod>(
    method: Method,
    payload: PickMessagePayloadValue<ComposeMessageAction<Method, 'request'>>,
    signal?: AbortSignal,
  ): Promise<PickMessagePayloadValue<ComposeMessageAction<Method, 'response'>>>;

  handleRequest<const Method extends HostApiMethod>(method: Method, handler: RequestHandler<Method>): VoidFunction;

  subscribe<const Method extends HostApiMethod>(
    method: Method,
    payload: PickMessagePayloadValue<ComposeMessageAction<Method, 'start'>>,
    callback: (payload: PickMessagePayloadValue<ComposeMessageAction<Method, 'receive'>>) => void,
  ): SubscriptionFor<Method>;

  handleSubscription<const Method extends HostApiMethod>(
    method: Method,
    handler: SubscriptionHandler<Method>,
  ): VoidFunction;

  // low level method, use on your own risk
  postMessage(requestId: string, payload: MessagePayloadSchema): void;

  // low level method, use on your own risk
  listenMessages<const Action extends MessageAction>(
    action: Action,
    callback: (requestId: string, data: PickMessagePayload<Action>) => void,
    onError?: (error: unknown) => void,
  ): VoidFunction;

  /**
   * EXPERIMENTAL. Subscribe to every message crossing this transport
   * in either direction, in decoded form. Returns an unsubscribe
   * function. Multiple listeners are supported; the underlying
   * provider is subscribed lazily — there is no per-message cost
   * while no listener is attached.
   */
  onDebugMessage(callback: (event: DebugMessageEvent) => void): VoidFunction;
};
