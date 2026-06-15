import type {
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
  ChatBotRegistrationErr,
  ChatMessagePostingErr,
  ChatRoomRegistrationErr,
  CreateProofErr,
  CreateTransactionErr,
  DeriveEntropyErr,
  DevicePermission,
  GenericError,
  GetUserIdErr,
  LoginErr,
  NavigateToErr,
  PaymentBalanceErr,
  PaymentRequestErr,
  PaymentStatusErr,
  PaymentTopUpErr,
  PreimageSubmitErr,
  PushNotificationError,
  RemotePermission,
  RequestCredentialsErr,
  ResourceAllocationErr,
  SigningErr,
  StatementProofErr,
  StorageErr,
  createTransport,
  enumValue,
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

const UNSUPPORTED_MESSAGE_FORMAT_ERROR = 'Unsupported message format';

const NOT_IMPLEMENTED = 'Not implemented';

type RequestSlot<Method extends HostApiMethod> = {
  update(handler: RequestHandler<Method>): VoidFunction;
  call: RequestHandler<Method>;
};

type SubscriptionSlot<Method extends HostApiMethod> = {
  update(handler: SubscriptionHandler<Method>): VoidFunction;
  makeDefaultInterrupt(): InterruptPayloadFor<HostApiProtocol[Method]>;
};

type ErrorResponse<Call extends VersionedProtocolRequest | VersionedProtocolSubscription> =
  Call extends VersionedProtocolRequest ? UnwrapErrorResponse<'v1', CodecValue<Call['response']>> : never;

type InterruptPayloadFor<Call extends VersionedProtocolRequest | VersionedProtocolSubscription> =
  Call extends VersionedProtocolSubscription ? CodecValue<Call['interrupt']> : never;

type ContainerRequestHandlerGuard<Call extends VersionedProtocolRequest | VersionedProtocolSubscription> =
  Call extends VersionedProtocolRequest ? ContainerRequestHandler<'v1', Call> : never;

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

  function makeNotImplementedSlot<const Method extends HostApiMethod>(
    method: Method,
    makeError: () => ErrorResponse<HostApiProtocol[Method]>,
  ): RequestSlot<Method> {
    // Cast needed: async () returns a fixed v1 error shape that TypeScript can't verify
    // matches the generic Method's response type without evaluating template literal types.
    const handler: RequestHandler<Method> = async () =>
      enumValue('v1', resultErr(makeError())) as unknown as Awaited<ReturnType<RequestHandler<Method>>>;
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
    const defaultHandler: RequestHandler<Method> = async () =>
      enumValue('v1', resultErr(makeError())) as unknown as Awaited<ReturnType<RequestHandler<Method>>>;
    let current = defaultHandler;
    let version = 0;

    transport.handleRequest(method, async params => {
      const permissionResponse = await handleRemotePermissionSlot.call(
        enumValue('v1', enumValue(permissionVariant as never, undefined)),
      );
      const permissionGranted =
        isEnumVariant(permissionResponse, 'v1') &&
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
    const defaultHandler: RequestHandler<Method> = async () =>
      enumValue('v1', resultErr(makeError())) as unknown as Awaited<ReturnType<RequestHandler<Method>>>;
    let current = defaultHandler;
    let version = 0;

    transport.handleRequest(method, async params => {
      const permissionResponse = await handleDevicePermissionSlot.call(enumValue('v1', permissionVariant));
      const permissionGranted =
        isEnumVariant(permissionResponse, 'v1') &&
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
    makeError: () => ErrorResponse<HostApiProtocol[Method]>,
    handler: ContainerRequestHandlerGuard<HostApiProtocol[Method]>,
  ): VoidFunction {
    init();
    const version = 'v1' as const;
    return slot.update(async params => {
      const error = makeError();
      return guardVersion(params, version, error)
        .asyncMap(async p => await handler(p as never, { ok: okAsync<any>, err: errAsync<never, any> }))
        .andThen(r => r.map(v => enumValue(version, resultOk(v))))
        .orElse(r => ok(enumValue(version, resultErr(r))))
        .unwrapOr(enumValue(version, resultErr(error))) as unknown as Awaited<ReturnType<RequestHandler<Method>>>;
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
  const handleGetUserIdSlot = makeNotImplementedSlot(
    'host_get_user_id',
    () => new GetUserIdErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleRequestLoginSlot = makeNotImplementedSlot(
    'host_request_login',
    () => new LoginErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleAccountGetSlot = makeNotImplementedSlot(
    'host_account_get',
    () => new RequestCredentialsErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleAccountGetAliasSlot = makeNotImplementedSlot(
    'host_account_get_alias',
    () => new RequestCredentialsErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleGetLegacyAccountsSlot = makeNotImplementedSlot(
    'host_get_legacy_accounts',
    () => new RequestCredentialsErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleAccountCreateProofSlot = makeNotImplementedSlot(
    'host_account_create_proof',
    () => new CreateProofErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  // entropy derivation slot
  const handleDeriveEntropySlot = makeNotImplementedSlot(
    'host_derive_entropy',
    () => new DeriveEntropyErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  // storage slots
  const handleLocalStorageReadSlot = makeNotImplementedSlot(
    'host_local_storage_read',
    () => new StorageErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleLocalStorageWriteSlot = makeNotImplementedSlot(
    'host_local_storage_write',
    () => new StorageErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleLocalStorageClearSlot = makeNotImplementedSlot(
    'host_local_storage_clear',
    () => new StorageErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  // signing slots
  const handleSignRawSlot = makeNotImplementedSlot(
    'host_sign_raw',
    () => new SigningErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleSignPayloadSlot = makeNotImplementedSlot(
    'host_sign_payload',
    () => new SigningErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleSignRawWithLegacyAccountSlot = makeNotImplementedSlot(
    'host_sign_raw_with_legacy_account',
    () => new SigningErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleSignPayloadWithLegacyAccountSlot = makeNotImplementedSlot(
    'host_sign_payload_with_legacy_account',
    () => new SigningErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleCreateTransactionSlot = makeNotImplementedSlot(
    'host_create_transaction',
    () => new CreateTransactionErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleCreateTransactionWithLegacyAccountSlot = makeNotImplementedSlot(
    'host_create_transaction_with_legacy_account',
    () => new CreateTransactionErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleFeatureSupportedSlot = makeNotImplementedSlot(
    'host_feature_supported',
    () => new GenericError({ reason: NOT_IMPLEMENTED }),
  );

  const handleDevicePermissionSlot = makeNotImplementedSlot(
    'host_device_permission',
    () => new GenericError({ reason: NOT_IMPLEMENTED }),
  );

  const handleRemotePermissionSlot = makeNotImplementedSlot(
    'remote_permission',
    () => new GenericError({ reason: NOT_IMPLEMENTED }),
  );

  const handlePushNotificationSlot = makeDevicePermissionGatedRequestSlot(
    'host_push_notification',
    'Notifications',
    () => new PushNotificationError.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handlePushNotificationCancelSlot = makeDevicePermissionGatedRequestSlot(
    'host_push_notification_cancel',
    'Notifications',
    () => new GenericError({ reason: NOT_IMPLEMENTED }),
  );

  const handleNavigateToSlot = makeNotImplementedSlot(
    'host_navigate_to',
    () => new NavigateToErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleChatCreateRoomSlot = makeNotImplementedSlot(
    'host_chat_create_room',
    () => new ChatRoomRegistrationErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleChatBotRegistrationSlot = makeNotImplementedSlot(
    'host_chat_register_bot',
    () => new ChatBotRegistrationErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleChatPostMessageSlot = makeNotImplementedSlot(
    'host_chat_post_message',
    () => new ChatMessagePostingErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleStatementStoreSubmitSlot = makePermissionGatedRequestSlot(
    'remote_statement_store_submit',
    'StatementSubmit',
    () => new GenericError({ reason: NOT_IMPLEMENTED }),
  );

  const handleStatementStoreCreateProofSlot = makeNotImplementedSlot(
    'remote_statement_store_create_proof',
    () => new StatementProofErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleStatementStoreCreateProofAuthorizedSlot = makeNotImplementedSlot(
    'remote_statement_store_create_proof_authorized',
    () => new StatementProofErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handlePreimageSubmitSlot = makePermissionGatedRequestSlot(
    'remote_preimage_submit',
    'PreimageSubmit',
    () => new PreimageSubmitErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  // payment request slots
  const handlePaymentTopUpSlot = makeNotImplementedSlot(
    'host_payment_top_up',
    () => new PaymentTopUpErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handlePaymentRequestSlot = makeNotImplementedSlot(
    'host_payment_request',
    () => new PaymentRequestErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  // resource allocation slot
  const handleRequestResourceAllocationSlot = makeNotImplementedSlot(
    'host_request_resource_allocation',
    () => new ResourceAllocationErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  // subscription slots — default interrupts on next microtask so that
  // the caller has a chance to register an onInterrupt listener first
  const handleThemeSubscribeSlot = makeInterruptSlot('host_theme_subscribe', () => enumValue('v1', undefined));
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
    enumValue('v1', new PaymentBalanceErr.Unknown({ reason: NOT_IMPLEMENTED })),
  );
  const handlePaymentStatusSubscribeSlot = makeInterruptSlot('host_payment_status_subscribe', () =>
    enumValue('v1', new PaymentStatusErr.Unknown({ reason: NOT_IMPLEMENTED })),
  );

  return {
    handleFeatureSupported(handler) {
      return handleV1Request(
        handleFeatureSupportedSlot,
        () => new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleDevicePermission(handler) {
      return handleV1Request(
        handleDevicePermissionSlot,
        () => new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handlePermission(handler) {
      return handleV1Request(
        handleRemotePermissionSlot,
        () => new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handlePushNotification(handler) {
      return handleV1Request(
        handlePushNotificationSlot,
        () => new PushNotificationError.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handlePushNotificationCancel(handler) {
      return handleV1Request(
        handlePushNotificationCancelSlot,
        () => new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleNavigateTo(handler) {
      return handleV1Request(
        handleNavigateToSlot,
        () => new NavigateToErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleDeriveEntropy(handler) {
      return handleV1Request(
        handleDeriveEntropySlot,
        () => new DeriveEntropyErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleLocalStorageRead(handler) {
      return handleV1Request(
        handleLocalStorageReadSlot,
        () => new StorageErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleLocalStorageWrite(handler) {
      return handleV1Request(
        handleLocalStorageWriteSlot,
        () => new StorageErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleLocalStorageClear(handler) {
      return handleV1Request(
        handleLocalStorageClearSlot,
        () => new StorageErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleThemeSubscribe(handler) {
      return handleV1Subscription(handleThemeSubscribeSlot, handler);
    },

    handleGetUserId(handler) {
      return handleV1Request(
        handleGetUserIdSlot,
        () => new GetUserIdErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleRequestLogin(handler) {
      return handleV1Request(
        handleRequestLoginSlot,
        () => new LoginErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleAccountConnectionStatusSubscribe(handler) {
      return handleV1Subscription(handleAccountConnectionStatusSubscribeSlot, handler);
    },

    handleAccountGet(handler) {
      return handleV1Request(
        handleAccountGetSlot,
        () => new RequestCredentialsErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleAccountGetAlias(handler) {
      return handleV1Request(
        handleAccountGetAliasSlot,
        () => new RequestCredentialsErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleAccountCreateProof(handler) {
      return handleV1Request(
        handleAccountCreateProofSlot,
        () => new CreateProofErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleGetLegacyAccounts(handler) {
      return handleV1Request(
        handleGetLegacyAccountsSlot,
        () => new RequestCredentialsErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleCreateTransaction(handler) {
      return handleV1Request(
        handleCreateTransactionSlot,
        () => new CreateTransactionErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleCreateTransactionWithLegacyAccount(handler) {
      return handleV1Request(
        handleCreateTransactionWithLegacyAccountSlot,
        () => new CreateTransactionErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleSignRaw(handler) {
      return handleV1Request(
        handleSignRawSlot,
        () => new SigningErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleSignPayload(handler) {
      return handleV1Request(
        handleSignPayloadSlot,
        () => new SigningErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleSignRawWithLegacyAccount(handler) {
      return handleV1Request(
        handleSignRawWithLegacyAccountSlot,
        () => new SigningErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleSignPayloadWithLegacyAccount(handler) {
      return handleV1Request(
        handleSignPayloadWithLegacyAccountSlot,
        () => new SigningErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleChatCreateRoom(handler) {
      return handleV1Request(
        handleChatCreateRoomSlot,
        () => new ChatRoomRegistrationErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleChatBotRegistration(handler) {
      return handleV1Request(
        handleChatBotRegistrationSlot,
        () => new ChatBotRegistrationErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleChatListSubscribe(handler) {
      return handleV1Subscription(handleChatListSubscribeSlot, handler);
    },

    handleChatPostMessage(handler) {
      return handleV1Request(
        handleChatPostMessageSlot,
        () => new ChatMessagePostingErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
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
      return handleV1Request(
        handleStatementStoreCreateProofSlot,
        () => new StatementProofErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleStatementStoreCreateProofAuthorized(handler) {
      return handleV1Request(
        handleStatementStoreCreateProofAuthorizedSlot,
        () => new StatementProofErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleStatementStoreSubmit(handler) {
      return handleV1Request(
        handleStatementStoreSubmitSlot,
        () => new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handlePreimageLookupSubscribe(handler) {
      return handleV1Subscription(handlePreimageLookupSubscribeSlot, handler);
    },

    handlePreimageSubmit(handler) {
      return handleV1Request(
        handlePreimageSubmitSlot,
        () => new PreimageSubmitErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handlePaymentBalanceSubscribe(handler) {
      return handleV1Subscription(handlePaymentBalanceSubscribeSlot, handler);
    },

    handlePaymentTopUp(handler) {
      return handleV1Request(
        handlePaymentTopUpSlot,
        () => new PaymentTopUpErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handlePaymentRequest(handler) {
      return handleV1Request(
        handlePaymentRequestSlot,
        () => new PaymentRequestErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handlePaymentStatusSubscribe(handler) {
      return handleV1Subscription(handlePaymentStatusSubscribeSlot, handler);
    },

    handleRequestResourceAllocation(handler) {
      return handleV1Request(
        handleRequestResourceAllocationSlot,
        () => new ResourceAllocationErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
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
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
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
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
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
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
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
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
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
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
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
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
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
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
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
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
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
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
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
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
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
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
          }
          const { genesisHash, transaction } = message.value;

          const permissionResponse = await handleRemotePermissionSlot.call(
            enumValue('v1', enumValue('ChainSubmit', undefined)),
          );
          const permissionGranted =
            isEnumVariant(permissionResponse, 'v1') &&
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
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
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
