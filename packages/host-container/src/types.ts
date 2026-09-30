import type {
  ConnectionStatus,
  DecodedMessage,
  HexString,
  InterruptPayload,
  MethodName,
  ProtocolMethod,
  ReceivePayload,
  RequestMethodName,
  RequestPayload,
  ResponsePayload,
  StartPayload,
  Subscription,
  SubscriptionMethodName,
  TraitName,
  VersionedProtocolSubscription,
} from '@novasamatech/host-api';
import type { ResultAsync, errAsync, okAsync } from 'neverthrow';
import type { JsonRpcProvider } from 'polkadot-api';

type SuccessResponse<T> = T extends { success: true; value: infer U } ? U : never;
type ErrorResponse<T> = T extends { success: false; value: infer U } ? U : never;

type OrPromise<T> = T | Promise<T>;
type ExtractEnumValue<T> = T extends { tag: string; value: infer V } ? V : never;

export type WithVersion<V extends string, T> = ExtractEnumValue<Extract<T, { tag: V }>>;

export type UnwrapSuccessResponse<V extends string, T> = T extends { tag: infer Tag; value: infer Value }
  ? WithVersion<V, { tag: Tag; value: SuccessResponse<Value> }>
  : never;

export type UnwrapErrorResponse<V extends string, T> = T extends { tag: infer Tag; value: infer Value }
  ? WithVersion<V, { tag: Tag; value: ErrorResponse<Value> }>
  : never;

/**
 * The version a host handler works in. A handler always sees the latest
 * version of its method: the container upgrades an older request to it and
 * answers each caller in the version it spoke. Methods not listed here have a
 * single version.
 */
type HandlerVersions = {
  localStorage: { read: 'v2' };
};

export type HandlerVersion<T extends TraitName, M extends string> = T extends keyof HandlerVersions
  ? M extends keyof HandlerVersions[T]
    ? HandlerVersions[T][M]
    : 'v1'
  : 'v1';

export type ContainerRequestHandler<
  T extends TraitName,
  M extends RequestMethodName<T>,
  V extends string = HandlerVersion<T, M>,
> = (
  params: WithVersion<V, RequestPayload<T, M>>,
  helpers: {
    ok: typeof okAsync<UnwrapSuccessResponse<V, ResponsePayload<T, M>>>;
    err: typeof errAsync<never, UnwrapErrorResponse<V, ResponsePayload<T, M>>>;
    /**
     * Aborted when the product withdraws the call. The product has already
     * been answered `Cancelled` by then, so whatever the handler resolves with
     * afterwards is dropped.
     */
    signal: AbortSignal;
  },
) => OrPromise<
  ResultAsync<UnwrapSuccessResponse<V, ResponsePayload<T, M>>, UnwrapErrorResponse<V, ResponsePayload<T, M>>>
>;

/**
 * `interrupt(undefined)` completes the subscription cleanly; any other value
 * ends it with that domain error (or a transport failure marker).
 */
export type ContainerSubscriptionHandler<
  T extends TraitName,
  M extends SubscriptionMethodName<T>,
  V extends string = 'v1',
> = (
  params: WithVersion<V, StartPayload<T, M>>,
  send: (payload: WithVersion<V, ReceivePayload<T, M>>) => void,
  interrupt: (payload: WithVersion<V, InterruptPayload<T, M>>) => void,
) => VoidFunction;

/**
 * A host-initiated subscription: the host subscribes and the product serves
 * it (e.g. `renderer.render`).
 */
export type ContainerSubscribeFn<T extends TraitName, M extends SubscriptionMethodName<T>, V extends string = 'v1'> = (
  params: WithVersion<V, StartPayload<T, M>>,
  callback: (payload: WithVersion<V, ReceivePayload<T, M>>) => void,
) => Subscription<WithVersion<V, InterruptPayload<T, M>>>;

type HostInitiatedMethodName<T extends TraitName> = {
  [M in SubscriptionMethodName<T>]: ProtocolMethod<T, M> extends VersionedProtocolSubscription<any, 'host'> ? M : never;
}[SubscriptionMethodName<T>];

// Methods the container does not expose as their own `handle*` slot.
type UnservedMethods = {
  // The transport answers the handshake itself.
  system: 'handshake';
  // Served together by `handleChainConnection`.
  chain: Exclude<MethodName<'chain'>, 'getChainInfo'>;
};

type UnservedMethodName<T extends TraitName> = T extends keyof UnservedMethods ? UnservedMethods[T] : never;

type ServedRequestName<T extends TraitName> = Exclude<RequestMethodName<T>, UnservedMethodName<T>>;
type ServedSubscriptionName<T extends TraitName> = Exclude<
  SubscriptionMethodName<T>,
  UnservedMethodName<T> | HostInitiatedMethodName<T>
>;

/**
 * One trait's slots: `handle<Method>(handler)` for every product-initiated
 * method the container serves, returning a function that restores the
 * default handler; plus `<method>(params, callback)` for every host-initiated
 * subscription.
 */
export type ContainerTrait<T extends TraitName> = {
  [M in ServedRequestName<T> as `handle${Capitalize<M>}`]: (handler: ContainerRequestHandler<T, M>) => VoidFunction;
} & {
  [M in ServedSubscriptionName<T> as `handle${Capitalize<M>}`]: (
    handler: ContainerSubscriptionHandler<T, M>,
  ) => VoidFunction;
} & {
  [M in HostInitiatedMethodName<T>]: ContainerSubscribeFn<T, M>;
};

export type ContainerHandlerOf<T extends (...args: any[]) => any> = Parameters<T>[0];

/**
 * EXPERIMENTAL. Event describing a single message observed on a
 * container's transport, in decoded form, tagged with the productId
 * that was passed to `createContainer`.
 */
export type HostApiDebugMessageEvent = {
  direction: 'incoming' | 'outgoing';
  productId: string | undefined;
  requestId: string;
  payload: DecodedMessage;
};

export type CreateContainerOptions = {
  /**
   * Optional identifier for the product this container talks to.
   * When set, every debug event emitted via `onDebugMessage` and the
   * global `onHostApiDebugMessage` bus is tagged with this value.
   */
  productId?: string;
};

/**
 * Host-side container, nested the way the wire addresses methods:
 * `container.<trait>.handle<Method>(handler)`, e.g.
 * `container.account.handleGetAccount(...)`.
 */
export type Container = {
  [T in TraitName]: ContainerTrait<T>;
} & {
  // chain interaction

  /**
   * Serves every `chain` method except `getChainInfo` (see
   * `container.chain.handleGetChainInfo`) from JSON-RPC providers.
   */
  handleChainConnection: (factory: (genesisHash: HexString) => JsonRpcProvider | null) => VoidFunction;

  isReady(): Promise<boolean>;
  dispose(): void;

  subscribeProductConnectionStatus(callback: (connectionStatus: ConnectionStatus) => void): VoidFunction;

  /**
   * EXPERIMENTAL. Subscribe to every message crossing this container's
   * transport in either direction, in decoded form. Returns an
   * unsubscribe function.
   */
  onDebugMessage(callback: (event: HostApiDebugMessageEvent) => void): VoidFunction;
};
