import type {
  CallErrorTransportFailure,
  CodecType,
  ConnectionStatus,
  HexString,
  HostApiMethod,
  HostApiProtocol,
  Provider,
  RequestHandler,
  SubscriptionHandler,
  VersionedProtocolRequest,
  VersionedProtocolSubscription,
} from '@novasamatech/host-api';
import {
  CALL_ERROR_FAILURE,
  CoinPaymentErr,
  DevicePermission,
  GenericError,
  PaymentBalanceErr,
  PaymentStatusErr,
  PreimageSubmitErr,
  PushNotificationError,
  RemotePermission,
  createTransport,
  enumValue,
  isCallErrorFailure,
  isEnumVariant,
  resultErr,
  resultOk,
} from '@novasamatech/host-api';
import type { Result } from 'neverthrow';
import { err, errAsync, ok, okAsync } from 'neverthrow';

import { createChainConnectionManager } from './chainConnectionManager.js';
import { emitHostApiDebugMessage, registerHostApiDebugSource } from './debugBus.js';
import type {
  CodecValue,
  Container,
  ContainerRequestHandler,
  CreateContainerOptions,
  UnwrapErrorResponse,
} from './types.js';

// Reason attached to a `MalformedFrame` transport failure when an incoming
// request does not decode to the expected v1 shape.
const MALFORMED_FRAME_REASON = 'request did not decode to a supported version';

// Transport-level `CallError` envelopes, riding the same envelope the transport
// uses for a thrown handler (`HostFailure`). The host answers `Unsupported` when
// no handler is registered for a method, and `MalformedFrame` when a request
// does not decode. `host-api-wrapper` folds both into the method's own error
// type, so products keep a single error to handle.
const UNSUPPORTED = enumValue('v1', {
  [CALL_ERROR_FAILURE]: { tag: 'Unsupported' } as CallErrorTransportFailure,
});
const MALFORMED_FRAME = enumValue('v1', {
  [CALL_ERROR_FAILURE]: {
    tag: 'MalformedFrame',
    value: { reason: MALFORMED_FRAME_REASON },
  } as CallErrorTransportFailure,
});

// Cast helpers: the transport encodes these envelopes for any method's response
// codec, but TypeScript can't verify that against a generic `Method` here.
function unsupportedResponse<Method extends HostApiMethod>(): Awaited<ReturnType<RequestHandler<Method>>> {
  return UNSUPPORTED as unknown as Awaited<ReturnType<RequestHandler<Method>>>;
}
function malformedFrameResponse<Method extends HostApiMethod>(): Awaited<ReturnType<RequestHandler<Method>>> {
  return MALFORMED_FRAME as unknown as Awaited<ReturnType<RequestHandler<Method>>>;
}

type RequestSlot<Method extends HostApiMethod> = {
  update(handler: RequestHandler<Method>): VoidFunction;
  call: RequestHandler<Method>;
};

type SubscriptionSlot<Method extends HostApiMethod> = {
  update(handler: SubscriptionHandler<Method>): VoidFunction;
  makeDefaultInterrupt(): InterruptPayloadFor<HostApiProtocol[Method]>;
};

type InterruptPayloadFor<Call extends VersionedProtocolRequest | VersionedProtocolSubscription> =
  Call extends VersionedProtocolSubscription ? CodecValue<Call['interrupt']> : never;

type ContainerRequestHandlerGuard<Call extends VersionedProtocolRequest | VersionedProtocolSubscription> =
  Call extends VersionedProtocolRequest ? ContainerRequestHandler<'v1', Call> : never;

// Error response used by the permission-gated slots for a denied call (a
// business "no", distinct from `Unsupported`).
type ErrorResponse<Call extends VersionedProtocolRequest | VersionedProtocolSubscription> =
  Call extends VersionedProtocolRequest ? UnwrapErrorResponse<'v1', CodecValue<Call['response']>> : never;

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
  // otherwise the transport's lazy `Message.dec` path stays cold.
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

  function makeRequestSlot<const Method extends HostApiMethod>(
    method: Method,
    defaultHandler: RequestHandler<Method>,
  ): RequestSlot<Method> {
    let current: RequestHandler<Method> = defaultHandler;
    let version = 0;
    transport.handleRequest(method, params => current(params));
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

  function makeSubscriptionSlot<const Method extends HostApiMethod>(
    method: Method,
    defaultHandler: SubscriptionHandler<Method>,
  ): (handler: SubscriptionHandler<Method>) => VoidFunction {
    let current: SubscriptionHandler<Method> = defaultHandler;
    let version = 0;
    transport.handleSubscription(method, (params, send, interrupt) => current(params, send, interrupt));
    return handler => {
      current = handler;
      const myVersion = ++version;
      return () => {
        if (myVersion !== version) return;
        version++;
        current = defaultHandler;
      };
    };
  }

  // A method with no registered handler answers `Unsupported`.
  function makeUnsupportedSlot<const Method extends HostApiMethod>(method: Method): RequestSlot<Method> {
    const handler: RequestHandler<Method> = async () => unsupportedResponse<Method>();
    return makeRequestSlot(method, handler);
  }

  function makeInterruptSlot<const Method extends HostApiMethod>(
    method: Method,
    makeDefaultInterrupt: () => InterruptPayloadFor<HostApiProtocol[Method]>,
  ): SubscriptionSlot<Method> {
    const defaultHandler: SubscriptionHandler<Method> = (_params, _send, interrupt) => {
      // Cast needed: the default handler ignores typed params/send which TypeScript can't verify
      // matches the generic Method's subscription type without evaluating template literal types.
      queueMicrotask(() => interrupt(makeDefaultInterrupt() as never));
      return () => {
        /* nothing to clean up */
      };
    };
    const update = makeSubscriptionSlot(method, defaultHandler);
    return { update, makeDefaultInterrupt };
  }

  function makePermissionGatedRequestSlot<const Method extends HostApiMethod>(
    method: Method,
    permissionVariant: CodecType<typeof RemotePermission>['tag'],
    makeError: () => ErrorResponse<HostApiProtocol[Method]>,
  ): RequestSlot<Method> {
    // No registered handler → the method is unsupported.
    const defaultHandler: RequestHandler<Method> = async () => unsupportedResponse<Method>();
    let current = defaultHandler;
    let version = 0;

    transport.handleRequest(method, async params => {
      // No registered handler → the method is unsupported. Answer that before
      // the permission gate: an unimplemented method must not ask for a grant.
      if (current === defaultHandler) {
        return unsupportedResponse<Method>();
      }
      const permissionResponse = await handleRemotePermissionSlot.call(
        enumValue('v1', enumValue(permissionVariant as never, undefined)),
      );
      const permissionGranted =
        isEnumVariant(permissionResponse, 'v1') &&
        !isCallErrorFailure(permissionResponse.value) &&
        permissionResponse.value.success === true &&
        permissionResponse.value.value === true;
      if (!permissionGranted) {
        return enumValue('v1', resultErr(makeError())) as unknown as Awaited<ReturnType<RequestHandler<Method>>>;
      }
      return current(params);
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

  function makeDevicePermissionGatedRequestSlot<const Method extends HostApiMethod>(
    method: Method,
    permissionVariant: CodecType<typeof DevicePermission>,
    makeError: () => ErrorResponse<HostApiProtocol[Method]>,
  ): RequestSlot<Method> {
    // No registered handler → the method is unsupported.
    const defaultHandler: RequestHandler<Method> = async () => unsupportedResponse<Method>();
    let current = defaultHandler;
    let version = 0;

    transport.handleRequest(method, async params => {
      // No registered handler → the method is unsupported. Answer that before
      // the permission gate: an unimplemented method must not ask for a grant.
      if (current === defaultHandler) {
        return unsupportedResponse<Method>();
      }
      const permissionResponse = await handleDevicePermissionSlot.call(enumValue('v1', permissionVariant));
      const permissionGranted =
        isEnumVariant(permissionResponse, 'v1') &&
        !isCallErrorFailure(permissionResponse.value) &&
        permissionResponse.value.success === true &&
        permissionResponse.value.value === true;
      if (!permissionGranted) {
        return enumValue('v1', resultErr(makeError())) as unknown as Awaited<ReturnType<RequestHandler<Method>>>;
      }
      return current(params);
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

  function handleV1Request<const Method extends HostApiMethod>(
    slot: RequestSlot<Method>,
    handler: ContainerRequestHandlerGuard<HostApiProtocol[Method]>,
  ): VoidFunction {
    init();
    const version = 'v1' as const;
    return slot.update(async params => {
      const parsed = guardVersion(params, version, null);
      // A request that does not decode to the expected version is a
      // `MalformedFrame` transport failure, not a domain error.
      if (parsed.isErr()) {
        return malformedFrameResponse<Method>();
      }
      const result = await handler(parsed.value as never, { ok: okAsync<any>, err: errAsync<never, any> });
      return result.match(
        v => enumValue(version, resultOk(v)),
        e => enumValue(version, resultErr(e)),
      ) as unknown as Awaited<ReturnType<RequestHandler<Method>>>;
    });
  }

  function handleV1Subscription<const Method extends HostApiMethod>(
    slot: SubscriptionSlot<Method>,
    handler: (params: any, send: any, interrupt: any) => VoidFunction,
  ): VoidFunction {
    init();
    const version = 'v1' as const;
    const slotHandler = ((params: unknown, send: unknown, interrupt: (v: unknown) => void) => {
      return guardVersion(params as { tag: string; value: unknown }, version, null)
        .map(p =>
          handler(
            p as never,
            ((payload: unknown) => (send as (v: unknown) => void)(enumValue(version, payload))) as never,
            ((payload: unknown) => interrupt(enumValue(version, payload))) as never,
          ),
        )
        .orTee(() => interrupt(slot.makeDefaultInterrupt()))
        .unwrapOr(() => {
          /* empty */
        });
    }) as SubscriptionHandler<Method>;
    return slot.update(slotHandler);
  }

  // account slots
  const handleGetUserIdSlot = makeUnsupportedSlot('host_get_user_id');
  const handleRequestLoginSlot = makeUnsupportedSlot('host_request_login');
  const handleAccountGetSlot = makeUnsupportedSlot('host_account_get');
  const handleAccountGetAliasSlot = makeUnsupportedSlot('host_account_get_alias');
  const handleGetLegacyAccountsSlot = makeUnsupportedSlot('host_get_legacy_accounts');
  const handleAccountCreateProofSlot = makeUnsupportedSlot('host_account_create_proof');
  const handleAccountSignVrfSlot = makeUnsupportedSlot('host_account_sign_vrf');

  // ring VRF key registry slots (RFC-0024)
  const handleAccountRegisterRingVrfKeySlot = makeUnsupportedSlot('host_account_register_ring_vrf_key');
  const handleAccountListRingVrfKeysSlot = makeUnsupportedSlot('host_account_list_ring_vrf_keys');
  const handleAccountRingVrfSignSlot = makeUnsupportedSlot('host_account_ring_vrf_sign');

  // chain info slot
  const handleChainGetChainInfoSlot = makeUnsupportedSlot('remote_chain_get_chain_info');

  // entropy derivation slot
  const handleDeriveEntropySlot = makeUnsupportedSlot('host_derive_entropy');

  // storage slots
  const handleLocalStorageReadSlot = makeUnsupportedSlot('host_local_storage_read');
  const handleLocalStorageWriteSlot = makeUnsupportedSlot('host_local_storage_write');
  const handleLocalStorageClearSlot = makeUnsupportedSlot('host_local_storage_clear');

  // worker slots
  const handleWorkerBeginOperationSlot = makeUnsupportedSlot('host_worker_begin_operation');
  const handleWorkerEndOperationSlot = makeUnsupportedSlot('host_worker_end_operation');

  // signing slots
  const handleSignRawSlot = makeUnsupportedSlot('host_sign_raw');
  const handleSignPayloadSlot = makeUnsupportedSlot('host_sign_payload');
  const handleSignRawWithLegacyAccountSlot = makeUnsupportedSlot('host_sign_raw_with_legacy_account');
  const handleSignPayloadWithLegacyAccountSlot = makeUnsupportedSlot('host_sign_payload_with_legacy_account');
  const handleCreateTransactionSlot = makeUnsupportedSlot('host_create_transaction');
  const handleCreateTransactionWithLegacyAccountSlot = makeUnsupportedSlot(
    'host_create_transaction_with_legacy_account',
  );

  const handleFeatureSupportedSlot = makeUnsupportedSlot('host_feature_supported');
  const handleDevicePermissionSlot = makeUnsupportedSlot('host_device_permission');
  const handleRemotePermissionSlot = makeUnsupportedSlot('remote_permission');

  const handlePushNotificationSlot = makeDevicePermissionGatedRequestSlot(
    'host_push_notification',
    'Notifications',
    () => new PushNotificationError.Unknown({ reason: 'Notifications permission denied' }),
  );

  const handlePushNotificationCancelSlot = makeDevicePermissionGatedRequestSlot(
    'host_push_notification_cancel',
    'Notifications',
    () => new GenericError({ reason: 'Notifications permission denied' }),
  );

  const handleNavigateToSlot = makeUnsupportedSlot('host_navigate_to');
  const handleChatCreateRoomSlot = makeUnsupportedSlot('host_chat_create_room');
  const handleChatBotRegistrationSlot = makeUnsupportedSlot('host_chat_register_bot');
  const handleChatPostMessageSlot = makeUnsupportedSlot('host_chat_post_message');

  const handleStatementStoreSubmitSlot = makePermissionGatedRequestSlot(
    'remote_statement_store_submit',
    'StatementSubmit',
    () => new GenericError({ reason: 'StatementSubmit permission denied' }),
  );

  const handleStatementStoreCreateProofSlot = makeUnsupportedSlot('remote_statement_store_create_proof');
  const handleStatementStoreCreateProofAuthorizedSlot = makeUnsupportedSlot(
    'remote_statement_store_create_proof_authorized',
  );

  const handlePreimageSubmitSlot = makePermissionGatedRequestSlot(
    'remote_preimage_submit',
    'PreimageSubmit',
    () => new PreimageSubmitErr.Unknown({ reason: 'PreimageSubmit permission denied' }),
  );

  // payment request slots
  const handlePaymentTopUpSlot = makeUnsupportedSlot('host_payment_top_up');
  const handlePaymentRequestSlot = makeUnsupportedSlot('host_payment_request');

  // resource allocation slot
  const handleRequestResourceAllocationSlot = makeUnsupportedSlot('host_request_resource_allocation');

  // coin payment request slots
  const handleCoinPaymentCreatePurseSlot = makeUnsupportedSlot('host_coin_payment_create_purse');
  const handleCoinPaymentQueryPurseSlot = makeUnsupportedSlot('host_coin_payment_query_purse');
  const handleCoinPaymentCreateReceivableSlot = makeUnsupportedSlot('host_coin_payment_create_receivable');
  const handleCoinPaymentCreateChequeSlot = makeUnsupportedSlot('host_coin_payment_create_cheque');

  // subscription slots — default interrupts on next microtask so that
  // the caller has a chance to register an onInterrupt listener first
  const handleThemeSubscribeSlot = makeInterruptSlot('host_theme_subscribe', () => enumValue('v1', undefined));
  const handleLocalStorageSubscribeSlot = makeInterruptSlot('host_local_storage_subscribe', () =>
    enumValue('v1', undefined),
  );
  const handleAccountConnectionStatusSubscribeSlot = makeInterruptSlot('host_account_connection_status_subscribe', () =>
    enumValue('v1', undefined),
  );
  const handleChatListSubscribeSlot = makeInterruptSlot('host_chat_list_subscribe', () => enumValue('v1', undefined));
  const handleChatActionSubscribeSlot = makeInterruptSlot('host_chat_action_subscribe', () =>
    enumValue('v1', undefined),
  );
  const handleStatementStoreSubscribeSlot = makeInterruptSlot('remote_statement_store_subscribe', () =>
    enumValue('v1', undefined),
  );
  const handlePreimageLookupSubscribeSlot = makeInterruptSlot('remote_preimage_lookup_subscribe', () =>
    enumValue('v1', undefined),
  );
  const handlePaymentBalanceSubscribeSlot = makeInterruptSlot('host_payment_balance_subscribe', () =>
    enumValue('v1', new PaymentBalanceErr.Unknown({ reason: 'Not implemented' })),
  );
  const handlePaymentStatusSubscribeSlot = makeInterruptSlot('host_payment_status_subscribe', () =>
    enumValue('v1', new PaymentStatusErr.Unknown({ reason: 'Not implemented' })),
  );
  const handleCoinPaymentRebalancePurseSlot = makeInterruptSlot('host_coin_payment_rebalance_purse', () =>
    enumValue('v1', new CoinPaymentErr.Internal()),
  );
  const handleCoinPaymentDeletePurseSlot = makeInterruptSlot('host_coin_payment_delete_purse', () =>
    enumValue('v1', new CoinPaymentErr.Internal()),
  );
  const handleCoinPaymentDepositSlot = makeInterruptSlot('host_coin_payment_deposit', () =>
    enumValue('v1', new CoinPaymentErr.Internal()),
  );
  const handleCoinPaymentRefundSlot = makeInterruptSlot('host_coin_payment_refund', () =>
    enumValue('v1', new CoinPaymentErr.Internal()),
  );
  const handleCoinPaymentListenForPaymentSlot = makeInterruptSlot('host_coin_payment_listen_for_payment', () =>
    enumValue('v1', new CoinPaymentErr.Internal()),
  );

  return {
    handleFeatureSupported(handler) {
      return handleV1Request(handleFeatureSupportedSlot, handler);
    },

    handleDevicePermission(handler) {
      return handleV1Request(handleDevicePermissionSlot, handler);
    },

    handlePermission(handler) {
      return handleV1Request(handleRemotePermissionSlot, handler);
    },

    handlePushNotification(handler) {
      return handleV1Request(handlePushNotificationSlot, handler);
    },

    handlePushNotificationCancel(handler) {
      return handleV1Request(handlePushNotificationCancelSlot, handler);
    },

    handleNavigateTo(handler) {
      return handleV1Request(handleNavigateToSlot, handler);
    },

    handleDeriveEntropy(handler) {
      return handleV1Request(handleDeriveEntropySlot, handler);
    },

    handleLocalStorageRead(handler) {
      return handleV1Request(handleLocalStorageReadSlot, handler);
    },

    handleLocalStorageWrite(handler) {
      return handleV1Request(handleLocalStorageWriteSlot, handler);
    },

    handleLocalStorageClear(handler) {
      return handleV1Request(handleLocalStorageClearSlot, handler);
    },

    handleThemeSubscribe(handler) {
      return handleV1Subscription(handleThemeSubscribeSlot, handler);
    },

    handleLocalStorageSubscribe(handler) {
      return handleV1Subscription(handleLocalStorageSubscribeSlot, handler);
    },

    handleWorkerBeginOperation(handler) {
      return handleV1Request(handleWorkerBeginOperationSlot, handler);
    },

    handleWorkerEndOperation(handler) {
      return handleV1Request(handleWorkerEndOperationSlot, handler);
    },

    handleGetUserId(handler) {
      return handleV1Request(handleGetUserIdSlot, handler);
    },

    handleRequestLogin(handler) {
      return handleV1Request(handleRequestLoginSlot, handler);
    },

    handleAccountConnectionStatusSubscribe(handler) {
      return handleV1Subscription(handleAccountConnectionStatusSubscribeSlot, handler);
    },

    handleAccountGet(handler) {
      return handleV1Request(handleAccountGetSlot, handler);
    },

    handleAccountGetAlias(handler) {
      return handleV1Request(handleAccountGetAliasSlot, handler);
    },

    handleAccountCreateProof(handler) {
      return handleV1Request(handleAccountCreateProofSlot, handler);
    },

    handleAccountSignVrf(handler) {
      return handleV1Request(handleAccountSignVrfSlot, handler);
    },

    handleAccountRegisterRingVrfKey(handler) {
      return handleV1Request(handleAccountRegisterRingVrfKeySlot, handler);
    },

    handleAccountListRingVrfKeys(handler) {
      return handleV1Request(handleAccountListRingVrfKeysSlot, handler);
    },

    handleAccountRingVrfSign(handler) {
      return handleV1Request(handleAccountRingVrfSignSlot, handler);
    },

    handleChainGetChainInfo(handler) {
      return handleV1Request(handleChainGetChainInfoSlot, handler);
    },

    handleGetLegacyAccounts(handler) {
      return handleV1Request(handleGetLegacyAccountsSlot, handler);
    },

    handleCreateTransaction(handler) {
      return handleV1Request(handleCreateTransactionSlot, handler);
    },

    handleCreateTransactionWithLegacyAccount(handler) {
      return handleV1Request(handleCreateTransactionWithLegacyAccountSlot, handler);
    },

    handleSignRaw(handler) {
      return handleV1Request(handleSignRawSlot, handler);
    },

    handleSignPayload(handler) {
      return handleV1Request(handleSignPayloadSlot, handler);
    },

    handleSignRawWithLegacyAccount(handler) {
      return handleV1Request(handleSignRawWithLegacyAccountSlot, handler);
    },

    handleSignPayloadWithLegacyAccount(handler) {
      return handleV1Request(handleSignPayloadWithLegacyAccountSlot, handler);
    },

    handleChatCreateRoom(handler) {
      return handleV1Request(handleChatCreateRoomSlot, handler);
    },

    handleChatBotRegistration(handler) {
      return handleV1Request(handleChatBotRegistrationSlot, handler);
    },

    handleChatListSubscribe(handler) {
      return handleV1Subscription(handleChatListSubscribeSlot, handler);
    },

    handleChatPostMessage(handler) {
      return handleV1Request(handleChatPostMessageSlot, handler);
    },

    handleChatActionSubscribe(handler) {
      return handleV1Subscription(handleChatActionSubscribeSlot, handler);
    },

    renderChatCustomMessage({ messageId, messageType, payload }, callback) {
      init();
      return transport.subscribe(
        'product_chat_custom_message_render_subscribe',
        enumValue('v1', { messageId, messageType, payload }),
        value => {
          if (value.tag === 'v1') {
            callback(value.value);
          }
        },
      );
    },

    handleStatementStoreSubscribe(handler) {
      return handleV1Subscription(handleStatementStoreSubscribeSlot, handler);
    },

    handleStatementStoreCreateProof(handler) {
      return handleV1Request(handleStatementStoreCreateProofSlot, handler);
    },

    handleStatementStoreCreateProofAuthorized(handler) {
      return handleV1Request(handleStatementStoreCreateProofAuthorizedSlot, handler);
    },

    handleStatementStoreSubmit(handler) {
      return handleV1Request(handleStatementStoreSubmitSlot, handler);
    },

    handlePreimageLookupSubscribe(handler) {
      return handleV1Subscription(handlePreimageLookupSubscribeSlot, handler);
    },

    handlePreimageSubmit(handler) {
      return handleV1Request(handlePreimageSubmitSlot, handler);
    },

    handlePaymentBalanceSubscribe(handler) {
      return handleV1Subscription(handlePaymentBalanceSubscribeSlot, handler);
    },

    handlePaymentTopUp(handler) {
      return handleV1Request(handlePaymentTopUpSlot, handler);
    },

    handlePaymentRequest(handler) {
      return handleV1Request(handlePaymentRequestSlot, handler);
    },

    handlePaymentStatusSubscribe(handler) {
      return handleV1Subscription(handlePaymentStatusSubscribeSlot, handler);
    },

    handleCoinPaymentCreatePurse(handler) {
      return handleV1Request(handleCoinPaymentCreatePurseSlot, handler);
    },

    handleCoinPaymentQueryPurse(handler) {
      return handleV1Request(handleCoinPaymentQueryPurseSlot, handler);
    },

    handleCoinPaymentRebalancePurse(handler) {
      return handleV1Subscription(handleCoinPaymentRebalancePurseSlot, handler);
    },

    handleCoinPaymentDeletePurse(handler) {
      return handleV1Subscription(handleCoinPaymentDeletePurseSlot, handler);
    },

    handleCoinPaymentCreateReceivable(handler) {
      return handleV1Request(handleCoinPaymentCreateReceivableSlot, handler);
    },

    handleCoinPaymentCreateCheque(handler) {
      return handleV1Request(handleCoinPaymentCreateChequeSlot, handler);
    },

    handleCoinPaymentDeposit(handler) {
      return handleV1Subscription(handleCoinPaymentDepositSlot, handler);
    },

    handleCoinPaymentRefund(handler) {
      return handleV1Subscription(handleCoinPaymentRefundSlot, handler);
    },

    handleCoinPaymentListenForPayment(handler) {
      return handleV1Subscription(handleCoinPaymentListenForPaymentSlot, handler);
    },

    handleRequestResourceAllocation(handler) {
      return handleV1Request(handleRequestResourceAllocationSlot, handler);
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
        transport.handleSubscription('remote_chain_head_follow_subscribe', (params, send, interrupt) => {
          if (!isEnumVariant(params, 'v1')) {
            interrupt(enumValue('v1', undefined));
            return () => {
              /* unsupported version */
            };
          }
          const { genesisHash, withRuntime } = params.value;

          const entry = manager.getOrCreateChain(genesisHash);
          if (!entry) {
            interrupt(enumValue('v1', undefined));
            return () => {
              /* no chain provider available */
            };
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
        transport.handleRequest('remote_chain_head_header', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME;
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
        transport.handleRequest('remote_chain_head_body', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME;
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
        transport.handleRequest('remote_chain_head_storage', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME;
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
        transport.handleRequest('remote_chain_head_call', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME;
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
        transport.handleRequest('remote_chain_head_unpin', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME;
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
        transport.handleRequest('remote_chain_head_continue', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME;
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
        transport.handleRequest('remote_chain_head_stop_operation', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME;
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
        transport.handleRequest('remote_chain_spec_genesis_hash', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME;
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
        transport.handleRequest('remote_chain_spec_chain_name', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME;
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
        transport.handleRequest('remote_chain_spec_properties', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME;
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
        transport.handleRequest('remote_chain_transaction_broadcast', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME;
          }
          const { genesisHash, transaction } = message.value;

          const permissionResponse = await handleRemotePermissionSlot.call(
            enumValue('v1', enumValue('ChainSubmit', undefined)),
          );
          const permissionGranted =
            isEnumVariant(permissionResponse, 'v1') &&
            !isCallErrorFailure(permissionResponse.value) &&
            permissionResponse.value.success === true &&
            permissionResponse.value.value === true;

          if (!permissionGranted) {
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
        transport.handleRequest('remote_chain_transaction_stop', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return MALFORMED_FRAME;
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
