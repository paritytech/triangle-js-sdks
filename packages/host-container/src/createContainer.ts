import type {
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
  GenericError,
  NavigateToErr,
  PreimageSubmitErr,
  RequestCredentialsErr,
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
import type { CodecValue, Container, ContainerRequestHandler, UnwrapErrorResponse } from './types.js';

const UNSUPPORTED_MESSAGE_FORMAT_ERROR = 'Unsupported message format';

const NOT_IMPLEMENTED = 'Not implemented';

type RequestSlot<Method extends HostApiMethod> = {
  update(handler: RequestHandler<Method>): VoidFunction;
  call: RequestHandler<Method>;
};

type ErrorResponse<Call extends VersionedProtocolRequest | VersionedProtocolSubscription> =
  Call extends VersionedProtocolRequest ? UnwrapErrorResponse<'v1', CodecValue<Call['response']>> : never;

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

export function createContainer(provider: Provider): Container {
  const transport = createTransport(provider);
  if (!transport.isCorrectEnvironment()) {
    throw new Error('Transport is not available: dapp provider has incorrect environment');
  }

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
  ): (handler: SubscriptionHandler<Method>) => VoidFunction {
    // Cast needed: the default handler ignores typed params/send which TypeScript can't verify
    // matches the generic Method's subscription type without evaluating template literal types.
    const defaultHandler = ((_params: unknown, _send: unknown, interrupt: VoidFunction) => {
      queueMicrotask(interrupt);
      return () => {
        /* nothing to clean up */
      };
    }) as SubscriptionHandler<Method>;
    return makeSubscriptionSlot(method, defaultHandler);
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
    slot: (handler: SubscriptionHandler<Method>) => VoidFunction,
    handler: (params: never, send: never, interrupt: VoidFunction) => VoidFunction,
  ): VoidFunction {
    init();
    const version = 'v1' as const;
    const slotHandler = ((params: unknown, send: unknown, interrupt: VoidFunction) => {
      return guardVersion(params as { tag: string; value: unknown }, version, null)
        .map(p =>
          handler(
            p as never,
            ((payload: unknown) => (send as (v: unknown) => void)(enumValue(version, payload))) as never,
            interrupt,
          ),
        )
        .orTee(interrupt)
        .unwrapOr(() => {
          /* empty */
        });
    }) as SubscriptionHandler<Method>;
    return slot(slotHandler);
  }

  // account slots
  const handleAccountGetSlot = makeNotImplementedSlot(
    'host_account_get',
    () => new RequestCredentialsErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleAccountGetAliasSlot = makeNotImplementedSlot(
    'host_account_get_alias',
    () => new RequestCredentialsErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleGetNonProductAccountsSlot = makeNotImplementedSlot(
    'host_get_non_product_accounts',
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

  const handleSignRawWithNonProductAccountSlot = makeNotImplementedSlot(
    'host_sign_raw_with_non_product_account',
    () => new SigningErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleSignPayloadWithNonProductAccountSlot = makeNotImplementedSlot(
    'host_sign_payload_with_non_product_account',
    () => new SigningErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleCreateTransactionSlot = makeNotImplementedSlot(
    'host_create_transaction',
    () => new CreateTransactionErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handleCreateTransactionWithNonProductAccountSlot = makeNotImplementedSlot(
    'host_create_transaction_with_non_product_account',
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

  const handlePushNotificationSlot = makeNotImplementedSlot(
    'host_push_notification',
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

  const handleStatementStoreSubmitSlot = makeNotImplementedSlot(
    'remote_statement_store_submit',
    () => new GenericError({ reason: NOT_IMPLEMENTED }),
  );

  const handleStatementStoreCreateProofSlot = makeNotImplementedSlot(
    'remote_statement_store_create_proof',
    () => new StatementProofErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  const handlePreimageSubmitSlot = makeNotImplementedSlot(
    'remote_preimage_submit',
    () => new PreimageSubmitErr.Unknown({ reason: NOT_IMPLEMENTED }),
  );

  // subscription slots — default interrupts on next microtask so that
  // the caller has a chance to register an onInterrupt listener first
  const handleThemeSubscribeSlot = makeInterruptSlot('host_theme_subscribe');
  const handleAccountConnectionStatusSubscribeSlot = makeInterruptSlot('host_account_connection_status_subscribe');
  const handleChatListSubscribeSlot = makeInterruptSlot('host_chat_list_subscribe');
  const handleChatActionSubscribeSlot = makeInterruptSlot('host_chat_action_subscribe');
  const handleStatementStoreSubscribeSlot = makeInterruptSlot('remote_statement_store_subscribe');
  const handlePreimageLookupSubscribeSlot = makeInterruptSlot('remote_preimage_lookup_subscribe');

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

    handleGetNonProductAccounts(handler) {
      return handleV1Request(
        handleGetNonProductAccountsSlot,
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

    handleCreateTransactionWithNonProductAccount(handler) {
      return handleV1Request(
        handleCreateTransactionWithNonProductAccountSlot,
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

    handleSignRawWithNonProductAccount(handler) {
      return handleV1Request(
        handleSignRawWithNonProductAccountSlot,
        () => new SigningErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleSignPayloadWithNonProductAccount(handler) {
      return handleV1Request(
        handleSignPayloadWithNonProductAccountSlot,
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

    // chain interaction

    handleChainConnection(factory) {
      init();
      const manager = createChainConnectionManager(factory);
      const cleanups: VoidFunction[] = [];

      // Follow subscription
      cleanups.push(
        transport.handleSubscription('remote_chain_head_follow', (params, send, interrupt) => {
          if (!isEnumVariant(params, 'v1')) {
            interrupt();
            return () => {
              /* unsupported version */
            };
          }
          const { genesisHash, withRuntime } = params.value;

          const entry = manager.getOrCreateChain(genesisHash);
          if (!entry) {
            interrupt();
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
          const realSubId = manager.getChainFollowSubId(genesisHash);

          if (!realSubId) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'No active follow for this chain' })));
          }

          try {
            const result = await manager.sendRequest(genesisHash, 'chainHead_v1_header', [realSubId, hash]);
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
          const realSubId = manager.getChainFollowSubId(genesisHash);

          if (!realSubId) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'No active follow for this chain' })));
          }

          try {
            const result = await manager.sendRequest(genesisHash, 'chainHead_v1_body', [realSubId, hash]);
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
          const realSubId = manager.getChainFollowSubId(genesisHash);

          if (!realSubId) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'No active follow for this chain' })));
          }

          const jsonRpcItems = items.map((item: { key: HexString; type: string }) => ({
            key: item.key,
            type: manager.convertStorageQueryTypeToJsonRpc(item.type),
          }));

          try {
            const result = await manager.sendRequest(genesisHash, 'chainHead_v1_storage', [
              realSubId,
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
          const realSubId = manager.getChainFollowSubId(params.genesisHash);

          if (!realSubId) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'No active follow for this chain' })));
          }

          try {
            const result = await manager.sendRequest(params.genesisHash, 'chainHead_v1_call', [
              realSubId,
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
          const realSubId = manager.getChainFollowSubId(genesisHash);

          if (!realSubId) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'No active follow for this chain' })));
          }

          try {
            await manager.sendRequest(genesisHash, 'chainHead_v1_unpin', [realSubId, hashes]);
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
          const realSubId = manager.getChainFollowSubId(genesisHash);

          if (!realSubId) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'No active follow for this chain' })));
          }

          try {
            await manager.sendRequest(genesisHash, 'chainHead_v1_continue', [realSubId, operationId]);
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
          const realSubId = manager.getChainFollowSubId(genesisHash);

          if (!realSubId) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'No active follow for this chain' })));
          }

          try {
            await manager.sendRequest(genesisHash, 'chainHead_v1_stopOperation', [realSubId, operationId]);
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

          try {
            const permissionResponse = await handleRemotePermissionSlot.call(
              enumValue('v1', enumValue('TransactionSubmit', undefined)),
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

            const result = await manager.sendRequest(genesisHash, 'transaction_v1_broadcast', [transaction]);
            manager.releaseChain(genesisHash);
            return enumValue('v1', resultOk((result as string) ?? null));
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

          const entry = manager.getOrCreateChain(genesisHash);
          if (!entry) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'Chain not supported' })));
          }

          try {
            await manager.sendRequest(genesisHash, 'transaction_v1_stop', [operationId]);
            manager.releaseChain(genesisHash);
            return enumValue('v1', resultOk(undefined));
          } catch (e) {
            manager.releaseChain(genesisHash);
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
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
  };
}
