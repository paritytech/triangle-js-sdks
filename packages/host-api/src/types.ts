import type { HostApiProtocol } from './protocol/impl.js';
import type {
  ComposeMessageAction,
  MessageAction,
  MessagePayloadSchema,
  PickMessagePayload,
  PickMessagePayloadValue,
} from './protocol/messageCodec.js';
import type { Provider } from './provider.js';

export type HostApiMethod = keyof HostApiProtocol;

export type Logger = Record<'info' | 'warn' | 'error' | 'log', (...args: unknown[]) => void>;

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type RequestHandler<Method extends string> = (
  message: PickMessagePayloadValue<ComposeMessageAction<Method, 'request'>>,
) => PromiseLike<PickMessagePayloadValue<ComposeMessageAction<Method, 'response'>>>;

export type SubscriptionHandler<Method extends string> = (
  params: PickMessagePayloadValue<ComposeMessageAction<Method, 'start'>>,
  send: (value: PickMessagePayloadValue<ComposeMessageAction<Method, 'receive'>>) => void,
  interrupt: () => void,
) => VoidFunction;

export type Subscription = {
  unsubscribe: VoidFunction;
  onInterrupt(callback: VoidFunction): VoidFunction;
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
  ): Subscription;

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
};
