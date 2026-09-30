import type {
  InterruptPayload,
  MethodName,
  ReceivePayload,
  RequestMethodName,
  RequestPayload,
  ResponsePayload,
  StartPayload,
  SubscriptionMethodName,
  TraitName,
} from './protocol/impl.js';
import type { Frame, MessageLeg } from './protocol/messageCodec.js';
import type { Provider } from './provider.js';

export type Logger = Record<'info' | 'warn' | 'error' | 'log', (...args: unknown[]) => void> & {
  withPrefix(prefix: string): Logger;
};

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

/** Per-call context handed to a request handler. */
export type RequestContext = {
  /**
   * Aborted when the caller withdraws the request (a `Cancel` frame). The
   * caller has already been answered `CallError::Cancelled` by then, so
   * whatever the handler resolves with afterwards is discarded.
   */
  signal: AbortSignal;
};

export type RequestHandler<T extends TraitName, M extends RequestMethodName<T>> = (
  message: RequestPayload<T, M>,
  context: RequestContext,
) => PromiseLike<ResponsePayload<T, M>>;

export type SubscriptionHandler<T extends TraitName, M extends SubscriptionMethodName<T>> = (
  params: StartPayload<T, M>,
  send: (value: ReceivePayload<T, M>) => void,
  interrupt: (value: InterruptPayload<T, M>) => void,
) => VoidFunction;

export type Subscription<InterruptPayload = unknown> = {
  unsubscribe: VoidFunction;
  onInterrupt(callback: (payload: InterruptPayload) => void): VoidFunction;
};

export type SubscriptionFor<T extends TraitName, M extends SubscriptionMethodName<T>> = Subscription<
  InterruptPayload<T, M>
>;

/** A frame decoded as far as this build understands it. */
export type DecodedMessage = {
  /** `undefined` for an address this build does not know, or a protocol error. */
  trait: TraitName | undefined;
  method: string | undefined;
  traitId: number;
  methodId: number;
  /** `undefined` when the address or its message type is unknown, or for a protocol-error frame. */
  leg: MessageLeg | undefined;
  /** The leg's decoded value; `undefined` when it carries none or could not be decoded. */
  value: unknown;
};

/**
 * EXPERIMENTAL. A single message observed on the transport, in its
 * decoded (non-SCALE) form. Intended for host-side introspection.
 */
export type DebugMessageEvent = {
  /** `outgoing` = sent by this side via `postMessage`; `incoming` = received from the peer. */
  direction: 'incoming' | 'outgoing';
  requestId: string;
  payload: DecodedMessage;
};

export type Transport = {
  readonly provider: Provider;

  isCorrectEnvironment(): boolean;
  isReady(): Promise<boolean>;
  destroy(): void;
  onConnectionStatusChange(callback: (status: ConnectionStatus) => void): VoidFunction;
  onDestroy(callback: VoidFunction): VoidFunction;

  /**
   * Send a request and resolve with its response leg. Aborting `signal`
   * withdraws the call on the wire (a `Cancel` frame) and rejects at once.
   */
  request<const T extends TraitName, const M extends RequestMethodName<T>>(
    trait: T,
    method: M,
    payload: RequestPayload<T, M>,
    signal?: AbortSignal,
  ): Promise<ResponsePayload<T, M>>;

  handleRequest<const T extends TraitName, const M extends RequestMethodName<T>>(
    trait: T,
    method: M,
    handler: RequestHandler<T, M>,
  ): VoidFunction;

  subscribe<const T extends TraitName, const M extends SubscriptionMethodName<T>>(
    trait: T,
    method: M,
    payload: StartPayload<T, M>,
    callback: (payload: ReceivePayload<T, M>) => void,
  ): SubscriptionFor<T, M>;

  handleSubscription<const T extends TraitName, const M extends SubscriptionMethodName<T>>(
    trait: T,
    method: M,
    handler: SubscriptionHandler<T, M>,
  ): VoidFunction;

  // low level method, use on your own risk
  postMessage(frame: Frame): void;

  // low level method, use on your own risk: every inbound frame, header decoded, payload raw
  listenMessages(callback: (frame: Frame) => void): VoidFunction;

  /**
   * EXPERIMENTAL. Subscribe to every message crossing this transport
   * in either direction, in decoded form. Returns an unsubscribe
   * function. Multiple listeners are supported; there is no per-message
   * decode cost while no listener is attached.
   */
  onDebugMessage(callback: (event: DebugMessageEvent) => void): VoidFunction;
};

export type { MethodName, TraitName };
