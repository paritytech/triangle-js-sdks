import type {
  CallErrorTransportFailure,
  CodecType,
  ConnectionStatus,
  HexString,
  InterruptPayload,
  Provider,
  ReceivePayload,
  RequestContext,
  RequestHandler,
  RequestMethodName,
  ResponsePayload,
  SubscriptionHandler,
  SubscriptionMethodName,
  TraitName,
} from '@novasamatech/host-api';
import {
  CoinPaymentErr,
  DevicePermission,
  GenericError,
  PaymentBalanceErr,
  PaymentStatusErr,
  PaymentTopUpStatusErr,
  PreimageSubmitErr,
  PushNotificationError,
  RemotePermission,
  StorageErr,
  StorageReadV2Err,
  callErrorMarker,
  createTransport,
  enumValue,
  isCallErrorFailure,
  isEnumVariant,
  resultErr,
  resultOk,
} from '@novasamatech/host-api';
import type { Result, ResultAsync } from 'neverthrow';
import { err, errAsync, ok, okAsync } from 'neverthrow';

import { createChainConnectionManager } from './chainConnectionManager.js';
import { emitHostApiDebugMessage, registerHostApiDebugSource } from './debugBus.js';
import type {
  Container,
  ContainerRequestHandler,
  ContainerSubscriptionHandler,
  CreateContainerOptions,
  UnwrapErrorResponse,
  WithVersion,
} from './types.js';

// Reason attached to a `MalformedFrame` transport failure when an incoming
// request does not decode to the version its handler works in.
const MALFORMED_FRAME_REASON = 'request did not decode to a supported version';

// Reason a v1 `localStorage.read` caller sees for a v2 `AccessNotGranted`. A
// v1 request carries no product, so it cannot provoke the refusal; the
// downgrade still has to be total (truapi `versioned/local_storage.rs`).
const ACCESS_NOT_GRANTED_REASON = 'the owning product grants no read access to its storage';

// Transport-level `CallError` failures, riding the same envelope the transport
// uses for a thrown handler (`HostFailure`). The host answers `Unsupported` when
// no handler is registered for a method, and `MalformedFrame` when a request
// does not decode. `host-api-wrapper` folds both into the method's own error
// type, so products keep a single error to handle.
const UNSUPPORTED: CallErrorTransportFailure = { tag: 'Unsupported' };
const MALFORMED_FRAME: CallErrorTransportFailure = {
  tag: 'MalformedFrame',
  value: { reason: MALFORMED_FRAME_REASON },
};

const MALFORMED_FRAME_V1 = enumValue('v1', callErrorMarker(MALFORMED_FRAME));

type Versioned = { tag: string; value: unknown };

type OrPromise<T> = T | Promise<T>;

// Loose shapes of the container-level handlers, used where TypeScript can't
// resolve a generic method's payload types. The public `Container` type keeps
// every slot precise.
type LooseRequestHandler = (
  params: unknown,
  helpers: { ok: typeof okAsync; err: typeof errAsync; signal: AbortSignal },
) => OrPromise<ResultAsync<unknown, unknown>>;
type LooseSubscriptionHandler = (
  params: unknown,
  send: (payload: unknown) => void,
  interrupt: (payload: unknown) => void,
) => VoidFunction;

type RequestSlot<T extends TraitName, M extends RequestMethodName<T>> = {
  update(handler: RequestHandler<T, M>): VoidFunction;
  call: RequestHandler<T, M>;
};

type SubscriptionSlot<T extends TraitName, M extends SubscriptionMethodName<T>> = {
  update(handler: SubscriptionHandler<T, M>): VoidFunction;
};

// A permission the host must grant before a slot's handler runs. A denied call
// answers `makeError()` — a business "no", distinct from `Unsupported`.
type PermissionGate<T extends TraitName, M extends RequestMethodName<T>> = {
  isGranted(context: RequestContext): Promise<boolean>;
  makeError(): UnwrapErrorResponse<'v1', ResponsePayload<T, M>>;
};

function noop() {
  /* nothing to clean up */
}

function versionOf(value: unknown): string {
  return (value as Versioned | undefined)?.tag ?? 'v1';
}

// Cast helpers: the transport encodes a failure for any method's response or
// interrupt codec, but TypeScript can't verify that against a generic method.
function failureResponse<T extends TraitName, M extends RequestMethodName<T>>(
  params: unknown,
  failure: CallErrorTransportFailure,
): ResponsePayload<T, M> {
  return enumValue(versionOf(params), callErrorMarker(failure)) as unknown as ResponsePayload<T, M>;
}
function failureInterrupt<T extends TraitName, M extends SubscriptionMethodName<T>>(
  params: unknown,
  failure: CallErrorTransportFailure,
): InterruptPayload<T, M> {
  return enumValue(versionOf(params), callErrorMarker(failure)) as unknown as InterruptPayload<T, M>;
}

function guardVersion<const Enum extends { tag: string; value: unknown }, const Tag extends Enum['tag'], const Err>(
  value: Enum | undefined,
  tag: Tag,
  error: Err,
): Result<Enum['value'], Err> {
  if (!value) {
    return err(error);
  }
  if (isEnumVariant(value, tag)) {
    return ok(value.value);
  }
  return err(error);
}

// Both permission methods answer a plain `bool` grant.
function isPermissionGranted(response: ResponsePayload<'permissions', 'requestRemotePermission'>): boolean {
  return (
    isEnumVariant(response, 'v1') &&
    !isCallErrorFailure(response.value) &&
    response.value.success === true &&
    response.value.value === true
  );
}

function downgradeStorageReadError(error: CodecType<typeof StorageReadV2Err>): CodecType<typeof StorageErr> {
  if (error instanceof StorageReadV2Err.Unknown) {
    return new StorageErr.Unknown(error.payload);
  }
  if (error instanceof StorageReadV2Err.Full) {
    return new StorageErr.Full();
  }
  return new StorageErr.Unknown({ reason: ACCESS_NOT_GRANTED_REASON });
}

export function createContainer(provider: Provider, options: CreateContainerOptions = {}): Container {
  const transport = createTransport(provider);
  if (!transport.isCorrectEnvironment()) {
    throw new Error('Transport is not available: dapp provider has incorrect environment');
  }
  const { productId } = options;

  // EXPERIMENTAL: forward every transport-level message into the
  // process-global debug bus, tagged with this container's productId.
  // The forwarder is registered as a bus *source* and only attaches to
  // `transport.onDebugMessage` while the bus has at least one subscriber —
  // otherwise the transport's lazy frame decode path stays cold.
  const unregisterGlobalDebugSource = registerHostApiDebugSource(() =>
    transport.onDebugMessage(({ direction, requestId, payload }) => {
      emitHostApiDebugMessage({ direction, productId, requestId, payload });
    }),
  );
  transport.onDestroy(unregisterGlobalDebugSource);

  function init() {
    // init status subscription
    transport.isReady();
  }

  // A request slot answers `Unsupported` until a handler is registered. A
  // gated slot additionally asks for its permission before every call.
  function makeRequestSlot<const T extends TraitName, const M extends RequestMethodName<T>>(
    trait: T,
    method: M,
    gate?: PermissionGate<T, M>,
  ): RequestSlot<T, M> {
    const defaultHandler: RequestHandler<T, M> = async params => failureResponse<T, M>(params, UNSUPPORTED);
    let current = defaultHandler;
    let version = 0;

    transport.handleRequest(trait, method, async (params, context) => {
      if (gate) {
        // No registered handler → the method is unsupported. Answer that before
        // the permission gate: an unimplemented method must not ask for a grant.
        if (current === defaultHandler) {
          return failureResponse<T, M>(params, UNSUPPORTED);
        }
        if (!(await gate.isGranted(context))) {
          return enumValue(versionOf(params), resultErr(gate.makeError())) as unknown as ResponsePayload<T, M>;
        }
      }
      return current(params, context);
    });

    return {
      update: handler => {
        current = handler;
        const myVersion = ++version;
        return () => {
          if (myVersion !== version) return;
          version++;
          current = defaultHandler;
        };
      },
      call: (...args) => current(...args),
    };
  }

  // A subscription slot interrupts at once until a handler is registered —
  // with `Unsupported`, unless the method has a domain default. The transport
  // latches the interrupt, so a caller attaching `onInterrupt` after
  // `subscribe()` returned still sees it.
  function makeSubscriptionSlot<const T extends TraitName, const M extends SubscriptionMethodName<T>>(
    trait: T,
    method: M,
    makeDefaultInterrupt?: () => WithVersion<'v1', InterruptPayload<T, M>>,
  ): SubscriptionSlot<T, M> {
    const defaultHandler: SubscriptionHandler<T, M> = (params, _send, interrupt) => {
      interrupt(
        makeDefaultInterrupt
          ? (enumValue(versionOf(params), makeDefaultInterrupt()) as unknown as InterruptPayload<T, M>)
          : failureInterrupt<T, M>(params, UNSUPPORTED),
      );
      return noop;
    };
    let current = defaultHandler;
    let version = 0;

    transport.handleSubscription(trait, method, (params, send, interrupt) => current(params, send, interrupt));

    return {
      update: handler => {
        current = handler;
        const myVersion = ++version;
        return () => {
          if (myVersion !== version) return;
          version++;
          current = defaultHandler;
        };
      },
    };
  }

  // Adapts a container-level handler (plain v1 params in, `ResultAsync` out) to
  // the transport's versioned request/response shapes.
  function serveV1Request<const T extends TraitName, const M extends RequestMethodName<T>>(slot: RequestSlot<T, M>) {
    return (handler: ContainerRequestHandler<T, M, 'v1'>): VoidFunction => {
      init();
      return slot.update(async (params, { signal }) => {
        const parsed = guardVersion(params as Versioned, 'v1', null);
        // A request that does not decode to the expected version is a
        // `MalformedFrame` transport failure, not a domain error.
        if (parsed.isErr()) {
          return failureResponse<T, M>(params, MALFORMED_FRAME);
        }
        const result = await (handler as unknown as LooseRequestHandler)(parsed.value, {
          ok: okAsync,
          err: errAsync,
          signal,
        });
        return result.match(
          v => enumValue('v1', resultOk(v)),
          e => enumValue('v1', resultErr(e)),
        ) as unknown as ResponsePayload<T, M>;
      });
    };
  }

  function serveV1Subscription<const T extends TraitName, const M extends SubscriptionMethodName<T>>(
    slot: SubscriptionSlot<T, M>,
  ) {
    return (handler: ContainerSubscriptionHandler<T, M, 'v1'>): VoidFunction => {
      init();
      return slot.update((params, send, interrupt) => {
        const parsed = guardVersion(params as Versioned, 'v1', null);
        if (parsed.isErr()) {
          interrupt(failureInterrupt<T, M>(params, MALFORMED_FRAME));
          return noop;
        }
        return (handler as unknown as LooseSubscriptionHandler)(
          parsed.value,
          payload => send(enumValue('v1', payload) as unknown as ReceivePayload<T, M>),
          payload => interrupt(enumValue('v1', payload) as unknown as InterruptPayload<T, M>),
        );
      });
    };
  }

  function serveRequest<const T extends TraitName, const M extends RequestMethodName<T>>(
    trait: T,
    method: M,
    gate?: PermissionGate<T, M>,
  ) {
    return serveV1Request(makeRequestSlot(trait, method, gate));
  }

  function serveSubscription<const T extends TraitName, const M extends SubscriptionMethodName<T>>(
    trait: T,
    method: M,
    makeDefaultInterrupt?: () => WithVersion<'v1', InterruptPayload<T, M>>,
  ) {
    return serveV1Subscription(makeSubscriptionSlot(trait, method, makeDefaultInterrupt));
  }

  // permission slots — the gated slots below consult these

  const requestDevicePermissionSlot = makeRequestSlot('permissions', 'requestDevicePermission');
  const requestRemotePermissionSlot = makeRequestSlot('permissions', 'requestRemotePermission');

  async function isRemotePermissionGranted(
    permission: CodecType<typeof RemotePermission>,
    context: RequestContext,
  ): Promise<boolean> {
    return isPermissionGranted(await requestRemotePermissionSlot.call(enumValue('v1', permission), context));
  }

  async function isDevicePermissionGranted(
    permission: CodecType<typeof DevicePermission>,
    context: RequestContext,
  ): Promise<boolean> {
    return isPermissionGranted(await requestDevicePermissionSlot.call(enumValue('v1', permission), context));
  }

  function remotePermissionGate<const T extends TraitName, const M extends RequestMethodName<T>>(
    permission: CodecType<typeof RemotePermission>,
    makeError: () => UnwrapErrorResponse<'v1', ResponsePayload<T, M>>,
  ): PermissionGate<T, M> {
    return { isGranted: context => isRemotePermissionGranted(permission, context), makeError };
  }

  function devicePermissionGate<const T extends TraitName, const M extends RequestMethodName<T>>(
    permission: CodecType<typeof DevicePermission>,
    makeError: () => UnwrapErrorResponse<'v1', ResponsePayload<T, M>>,
  ): PermissionGate<T, M> {
    return { isGranted: context => isDevicePermissionGranted(permission, context), makeError };
  }

  // localStorage.read has two versions. The host handler works in the latest
  // (v2) one; a v1 request upgrades to it and its answer downgrades back.
  const localStorageReadSlot = makeRequestSlot('localStorage', 'read');

  function handleLocalStorageRead(handler: ContainerRequestHandler<'localStorage', 'read'>): VoidFunction {
    init();
    return localStorageReadSlot.update(async (params, { signal }) => {
      // A v1 caller can only name its own storage, which is what an absent
      // `product` means in v2.
      const request = isEnumVariant(params, 'v1') ? { product: undefined, key: params.value } : params.value;
      const result = await handler(request, { ok: okAsync<any>, err: errAsync<never, any>, signal });
      if (isEnumVariant(params, 'v1')) {
        return result.match(
          v => enumValue('v1', resultOk(v)),
          e => enumValue('v1', resultErr(downgradeStorageReadError(e))),
        );
      }
      return result.match(
        v => enumValue('v2', resultOk(v)),
        e => enumValue('v2', resultErr(e)),
      );
    });
  }

  // chain slots — served together by `handleChainConnection`

  const chainSlots = {
    followHeadSubscribe: makeSubscriptionSlot('chain', 'followHeadSubscribe'),
    getHeadHeader: makeRequestSlot('chain', 'getHeadHeader'),
    getHeadBody: makeRequestSlot('chain', 'getHeadBody'),
    getHeadStorage: makeRequestSlot('chain', 'getHeadStorage'),
    callHead: makeRequestSlot('chain', 'callHead'),
    unpinHead: makeRequestSlot('chain', 'unpinHead'),
    continueHead: makeRequestSlot('chain', 'continueHead'),
    stopHeadOperation: makeRequestSlot('chain', 'stopHeadOperation'),
    getSpecGenesisHash: makeRequestSlot('chain', 'getSpecGenesisHash'),
    getSpecChainName: makeRequestSlot('chain', 'getSpecChainName'),
    getSpecProperties: makeRequestSlot('chain', 'getSpecProperties'),
    broadcastTransaction: makeRequestSlot('chain', 'broadcastTransaction'),
    stopTransaction: makeRequestSlot('chain', 'stopTransaction'),
  };

  const coinPaymentInternal = () => new CoinPaymentErr.Internal();

  return {
    system: {
      handleFeatureSupported: serveRequest('system', 'featureSupported'),
      handleNavigateTo: serveRequest('system', 'navigateTo'),
      handleInfo: serveRequest('system', 'info'),
      handleGetProductContext: serveRequest('system', 'getProductContext'),
    },

    account: {
      handleConnectionStatusSubscribe: serveSubscription('account', 'connectionStatusSubscribe'),
      handleGetAccount: serveRequest('account', 'getAccount'),
      handleGetAccountAlias: serveRequest('account', 'getAccountAlias'),
      handleCreateAccountProof: serveRequest('account', 'createAccountProof'),
      handleGetLegacyAccounts: serveRequest('account', 'getLegacyAccounts'),
      handleGetUserId: serveRequest('account', 'getUserId'),
      handleRequestLogin: serveRequest('account', 'requestLogin'),
      handleSignVrf: serveRequest('account', 'signVrf'),
      // ring VRF key registry (RFC-0024)
      handleRegisterRingVrfKey: serveRequest('account', 'registerRingVrfKey'),
      handleListRingVrfKeys: serveRequest('account', 'listRingVrfKeys'),
      handleRingVrfSign: serveRequest('account', 'ringVrfSign'),
    },

    chain: {
      handleGetChainInfo: serveRequest('chain', 'getChainInfo'),
    },

    chat: {
      handleCreateRoom: serveRequest('chat', 'createRoom'),
      handleRegisterBot: serveRequest('chat', 'registerBot'),
      handleListSubscribe: serveSubscription('chat', 'listSubscribe'),
      handlePostMessage: serveRequest('chat', 'postMessage'),
      handleActionSubscribe: serveSubscription('chat', 'actionSubscribe'),
    },

    // RFC 0017
    coinPayment: {
      handleCreatePurse: serveRequest('coinPayment', 'createPurse'),
      handleQueryPurse: serveRequest('coinPayment', 'queryPurse'),
      handleRebalancePurse: serveSubscription('coinPayment', 'rebalancePurse', coinPaymentInternal),
      handleDeletePurse: serveSubscription('coinPayment', 'deletePurse', coinPaymentInternal),
      handleCreateReceivable: serveRequest('coinPayment', 'createReceivable'),
      handleCreateCheque: serveRequest('coinPayment', 'createCheque'),
      handleDeposit: serveSubscription('coinPayment', 'deposit', coinPaymentInternal),
      handleRefund: serveSubscription('coinPayment', 'refund', coinPaymentInternal),
      handleListenForPayment: serveSubscription('coinPayment', 'listenForPayment', coinPaymentInternal),
    },

    entropy: {
      handleDerive: serveRequest('entropy', 'derive'),
    },

    localStorage: {
      handleRead: handleLocalStorageRead,
      handleWrite: serveRequest('localStorage', 'write'),
      handleClear: serveRequest('localStorage', 'clear'),
      handleSubscribe: serveSubscription('localStorage', 'subscribe'),
    },

    notifications: {
      handleSendPushNotification: serveRequest(
        'notifications',
        'sendPushNotification',
        devicePermissionGate(
          'Notifications',
          () => new PushNotificationError.Unknown({ reason: 'Notifications permission denied' }),
        ),
      ),
      handleCancelPushNotification: serveRequest(
        'notifications',
        'cancelPushNotification',
        devicePermissionGate('Notifications', () => new GenericError({ reason: 'Notifications permission denied' })),
      ),
    },

    payment: {
      handleBalanceSubscribe: serveSubscription(
        'payment',
        'balanceSubscribe',
        () => new PaymentBalanceErr.Unknown({ reason: 'Not implemented' }),
      ),
      handleTopUp: serveRequest('payment', 'topUp'),
      handleRequest: serveRequest('payment', 'request'),
      handleStatusSubscribe: serveSubscription(
        'payment',
        'statusSubscribe',
        () => new PaymentStatusErr.Unknown({ reason: 'Not implemented' }),
      ),
      handleTopUpStatusSubscribe: serveSubscription(
        'payment',
        'topUpStatusSubscribe',
        () => new PaymentTopUpStatusErr.Unknown({ reason: 'Not implemented' }),
      ),
    },

    permissions: {
      handleRequestDevicePermission: serveV1Request(requestDevicePermissionSlot),
      handleRequestRemotePermission: serveV1Request(requestRemotePermissionSlot),
      // Host-internal: authorize one operation, consuming an available
      // one-use grant. Never consulted by the gated slots.
      handleAuthorizeRemotePermission: serveRequest('permissions', 'authorizeRemotePermission'),
      handleAuthorizeDevicePermission: serveRequest('permissions', 'authorizeDevicePermission'),
    },

    preimage: {
      handleLookupSubscribe: serveSubscription('preimage', 'lookupSubscribe'),
      handleSubmit: serveRequest(
        'preimage',
        'submit',
        remotePermissionGate(
          enumValue('PreimageSubmit', undefined),
          () => new PreimageSubmitErr.Unknown({ reason: 'PreimageSubmit permission denied' }),
        ),
      ),
    },

    resourceAllocation: {
      handleRequest: serveRequest('resourceAllocation', 'request'),
    },

    signing: {
      handleCreateTransaction: serveRequest('signing', 'createTransaction'),
      handleCreateTransactionWithLegacyAccount: serveRequest('signing', 'createTransactionWithLegacyAccount'),
      handleSignRawWithLegacyAccount: serveRequest('signing', 'signRawWithLegacyAccount'),
      handleSignPayloadWithLegacyAccount: serveRequest('signing', 'signPayloadWithLegacyAccount'),
      handleSignRaw: serveRequest('signing', 'signRaw'),
      handleSignPayload: serveRequest('signing', 'signPayload'),
      handleSignRawUnwatermarkedDeprecated: serveRequest('signing', 'signRawUnwatermarkedDeprecated'),
      handleSignRawUnwatermarkedDeprecatedWithLegacyAccount: serveRequest(
        'signing',
        'signRawUnwatermarkedDeprecatedWithLegacyAccount',
      ),
    },

    statementStore: {
      handleSubscribe: serveSubscription('statementStore', 'subscribe'),
      handleCreateProof: serveRequest('statementStore', 'createProof'),
      handleSubmit: serveRequest(
        'statementStore',
        'submit',
        remotePermissionGate(
          enumValue('StatementSubmit', undefined),
          () => new GenericError({ reason: 'StatementSubmit permission denied' }),
        ),
      ),
      handleCreateProofAuthorized: serveRequest('statementStore', 'createProofAuthorized'),
    },

    theme: {
      handleSubscribe: serveSubscription('theme', 'subscribe'),
    },

    locale: {
      handleSubscribe: serveSubscription('locale', 'subscribe'),
    },

    renderer: {
      // Host-initiated: the host asks the product to draw a body, and the
      // product streams renderer trees back.
      render({ context, payload }, callback) {
        init();
        const subscription = transport.subscribe('renderer', 'render', enumValue('v1', { context, payload }), value => {
          if (isEnumVariant(value, 'v1')) {
            callback(value.value);
          }
        });
        return {
          unsubscribe: subscription.unsubscribe,
          onInterrupt: listener =>
            subscription.onInterrupt(value => {
              if (isEnumVariant(value, 'v1')) {
                listener(value.value);
              }
            }),
        };
      },
      handleActionSubscribe: serveSubscription('renderer', 'actionSubscribe'),
    },

    pocket: {
      handleListSubscribe: serveSubscription('pocket', 'listSubscribe'),
      handleRemoveCard: serveRequest('pocket', 'removeCard'),
    },

    worker: {
      handleBeginOperation: serveRequest('worker', 'beginOperation'),
      handleEndOperation: serveRequest('worker', 'endOperation'),
    },

    contacts: {
      handlePick: serveRequest('contacts', 'pick'),
    },

    // chain interaction

    handleChainConnection(factory) {
      init();
      const manager = createChainConnectionManager(factory);
      const cleanups: VoidFunction[] = [];
      // `${genesisHash}:${operationId}` for each broadcast holding a chain ref.
      const liveBroadcasts = new Set<string>();

      // Follow subscription
      cleanups.push(
        chainSlots.followHeadSubscribe.update((params, send, interrupt) => {
          if (!isEnumVariant(params, 'v1')) {
            interrupt(MALFORMED_FRAME_V1);
            return noop;
          }
          const { genesisHash, withRuntime } = params.value;

          const entry = manager.getOrCreateChain(genesisHash);
          if (!entry) {
            // no chain provider available
            interrupt(enumValue('v1', new GenericError({ reason: 'Chain not supported' })));
            return noop;
          }

          const { followId } = manager.startFollow(genesisHash, withRuntime, (event: unknown) => {
            const typedEvent = manager.convertJsonRpcEventToTyped(event as Record<string, unknown>);
            (send as (v: unknown) => void)(enumValue('v1', typedEvent));
          });

          return () => {
            manager.stopFollow(genesisHash, followId);
            manager.releaseChain(genesisHash);
          };
        }),
      );

      // Header request
      cleanups.push(
        chainSlots.getHeadHeader.update(async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME_V1;
          }
          const { genesisHash, hash } = message.value;

          if (!manager.hasActiveFollow(genesisHash)) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'No active follow for this chain' })));
          }

          try {
            const result = await manager.chainHeadOp(genesisHash, 'chainHead_v1_header', [hash]);
            return enumValue('v1', resultOk(result as HexString | null));
          } catch (e) {
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          }
        }),
      );

      // Body request
      cleanups.push(
        chainSlots.getHeadBody.update(async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME_V1;
          }
          const { genesisHash, hash } = message.value;

          if (!manager.hasActiveFollow(genesisHash)) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'No active follow for this chain' })));
          }

          try {
            const result = await manager.chainHeadOp(genesisHash, 'chainHead_v1_body', [hash]);
            return enumValue('v1', resultOk(manager.convertOperationStartedResult(result)));
          } catch (e) {
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          }
        }),
      );

      // Storage request
      cleanups.push(
        chainSlots.getHeadStorage.update(async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME_V1;
          }
          const { genesisHash, hash, items, childTrie } = message.value;

          if (!manager.hasActiveFollow(genesisHash)) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'No active follow for this chain' })));
          }

          const jsonRpcItems = items.map((item: { key: HexString; queryType: string }) => ({
            key: item.key,
            type: manager.convertStorageQueryTypeToJsonRpc(item.queryType),
          }));

          try {
            const result = await manager.chainHeadOp(genesisHash, 'chainHead_v1_storage', [
              hash,
              jsonRpcItems,
              childTrie,
            ]);
            return enumValue('v1', resultOk(manager.convertOperationStartedResult(result)));
          } catch (e) {
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          }
        }),
      );

      // Call request
      cleanups.push(
        chainSlots.callHead.update(async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME_V1;
          }
          const params = message.value;

          if (!manager.hasActiveFollow(params.genesisHash)) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'No active follow for this chain' })));
          }

          try {
            const result = await manager.chainHeadOp(params.genesisHash, 'chainHead_v1_call', [
              params.hash,
              params.function,
              params.callParameters,
            ]);
            return enumValue('v1', resultOk(manager.convertOperationStartedResult(result)));
          } catch (e) {
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          }
        }),
      );

      // Unpin request
      cleanups.push(
        chainSlots.unpinHead.update(async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME_V1;
          }
          const { genesisHash, hashes } = message.value;

          if (!manager.hasActiveFollow(genesisHash)) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'No active follow for this chain' })));
          }

          try {
            await manager.chainHeadOp(genesisHash, 'chainHead_v1_unpin', [hashes]);
            return enumValue('v1', resultOk(undefined));
          } catch (e) {
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          }
        }),
      );

      // Continue request
      cleanups.push(
        chainSlots.continueHead.update(async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME_V1;
          }
          const { genesisHash, operationId } = message.value;

          if (!manager.hasActiveFollow(genesisHash)) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'No active follow for this chain' })));
          }

          try {
            await manager.chainHeadOp(genesisHash, 'chainHead_v1_continue', [operationId]);
            return enumValue('v1', resultOk(undefined));
          } catch (e) {
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          }
        }),
      );

      // StopOperation request
      cleanups.push(
        chainSlots.stopHeadOperation.update(async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME_V1;
          }
          const { genesisHash, operationId } = message.value;

          if (!manager.hasActiveFollow(genesisHash)) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'No active follow for this chain' })));
          }

          try {
            await manager.chainHeadOp(genesisHash, 'chainHead_v1_stopOperation', [operationId]);
            return enumValue('v1', resultOk(undefined));
          } catch (e) {
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          }
        }),
      );

      // ChainSpec: genesis hash
      cleanups.push(
        chainSlots.getSpecGenesisHash.update(async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME_V1;
          }
          const genesisHash = message.value;

          const entry = manager.getOrCreateChain(genesisHash);
          if (!entry) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'Chain not supported' })));
          }

          try {
            const result = await manager.sendRequest(genesisHash, 'chainSpec_v1_genesisHash', []);
            manager.releaseChain(genesisHash);
            return enumValue('v1', resultOk(result as HexString));
          } catch (e) {
            manager.releaseChain(genesisHash);
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          }
        }),
      );

      // ChainSpec: chain name
      cleanups.push(
        chainSlots.getSpecChainName.update(async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME_V1;
          }
          const genesisHash = message.value;

          const entry = manager.getOrCreateChain(genesisHash);
          if (!entry) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'Chain not supported' })));
          }

          try {
            const result = await manager.sendRequest(genesisHash, 'chainSpec_v1_chainName', []);
            manager.releaseChain(genesisHash);
            return enumValue('v1', resultOk(result as string));
          } catch (e) {
            manager.releaseChain(genesisHash);
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          }
        }),
      );

      // ChainSpec: properties
      cleanups.push(
        chainSlots.getSpecProperties.update(async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME_V1;
          }
          const genesisHash = message.value;

          const entry = manager.getOrCreateChain(genesisHash);
          if (!entry) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'Chain not supported' })));
          }

          try {
            const result = await manager.sendRequest(genesisHash, 'chainSpec_v1_properties', []);
            manager.releaseChain(genesisHash);
            return enumValue('v1', resultOk(typeof result === 'string' ? result : JSON.stringify(result)));
          } catch (e) {
            manager.releaseChain(genesisHash);
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          }
        }),
      );

      // Transaction broadcast
      cleanups.push(
        chainSlots.broadcastTransaction.update(async (message, context) => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME_V1;
          }
          const { genesisHash, transaction } = message.value;

          if (!(await isRemotePermissionGranted(enumValue('ChainSubmit', undefined), context))) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'Permission denied' })));
          }

          const entry = manager.getOrCreateChain(genesisHash);
          if (!entry) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'Chain not supported' })));
          }

          try {
            const operationId = await manager.sendRequest<string | null>(genesisHash, 'transaction_v1_broadcast', [
              transaction,
            ]);
            // `transaction_v1_broadcast` is not one-shot: the node re-broadcasts
            // only while the connection lives, until a matching
            // `transaction_v1_stop`. Keep the chain ref acquired above by
            // recording the live operation; the stop handler releases it.
            // A null operationId means nothing to stop, so release now.
            if (operationId) {
              liveBroadcasts.add(`${genesisHash}:${operationId}`);
            } else {
              manager.releaseChain(genesisHash);
            }
            return enumValue('v1', resultOk(operationId));
          } catch (e) {
            manager.releaseChain(genesisHash);
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          }
        }),
      );

      // Transaction stop
      cleanups.push(
        chainSlots.stopTransaction.update(async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME_V1;
          }
          const { genesisHash, operationId } = message.value;

          // Only a stop matching a live broadcast releases the ref that broadcast
          // holds (over its still-open connection). Duplicate or unknown stops
          // are no-op successes, so refCount can't be driven below what the live
          // broadcasts justify.
          if (!liveBroadcasts.delete(`${genesisHash}:${operationId}`)) {
            return enumValue('v1', resultOk(undefined));
          }

          try {
            await manager.sendRequest(genesisHash, 'transaction_v1_stop', [operationId]);
            return enumValue('v1', resultOk(undefined));
          } catch (e) {
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          } finally {
            manager.releaseChain(genesisHash);
          }
        }),
      );

      let disposed = false;

      // Restores the chain slots' `Unsupported` defaults. Follows still open
      // stop receiving events once the manager tears its chains down.
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        unsubscribeDestroy();
        for (const fn of cleanups) fn();
        manager.dispose();
      };

      const unsubscribeDestroy = transport.onDestroy(dispose);

      return dispose;
    },

    isReady() {
      return transport.isReady();
    },

    subscribeProductConnectionStatus(callback: (connectionStatus: ConnectionStatus) => void) {
      // this specific order exists because container should report all connection statuses including "disconnected",
      // which immediately got changed to "connecting" after init() call.
      const unsubscribe = transport.onConnectionStatusChange(callback);
      init();
      return unsubscribe;
    },

    dispose() {
      transport.destroy();
    },

    onDebugMessage(callback) {
      return transport.onDebugMessage(({ direction, requestId, payload }) => {
        callback({ direction, productId, requestId, payload });
      });
    },
  };
}
