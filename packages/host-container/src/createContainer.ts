import type {
  ConnectionStatus,
  HexString,
  HostApiMethod,
  Provider,
  RequestHandler,
  SubscriptionHandler,
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
import type { Container } from './types.js';

const UNSUPPORTED_MESSAGE_FORMAT_ERROR = 'Unsupported message format';

const NOT_IMPLEMENTED = 'Not implemented';

type RequestSlot<Method extends HostApiMethod> = {
  update(handler: RequestHandler<Method>): VoidFunction;
  call: RequestHandler<Method>;
};

function guardVersion<const Enum extends { tag: string; value: unknown }, const Tag extends Enum['tag'], const Err>(
  value: Enum,
  tag: Tag,
  error: Err,
): Result<Enum['value'], Err> {
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

  // account slots
  const handleAccountGetSlot = makeRequestSlot('host_account_get', async () => {
    const error = new RequestCredentialsErr.Unknown({ reason: NOT_IMPLEMENTED });
    return enumValue('v1', resultErr(error));
  });

  const handleAccountGetAliasSlot = makeRequestSlot('host_account_get_alias', async () => {
    const error = new RequestCredentialsErr.Unknown({ reason: NOT_IMPLEMENTED });
    return enumValue('v1', resultErr(error));
  });

  const handleGetNonProductAccountsSlot = makeRequestSlot('host_get_non_product_accounts', async () => {
    const error = new RequestCredentialsErr.Unknown({ reason: NOT_IMPLEMENTED });
    return enumValue('v1', resultErr(error));
  });

  const handleAccountCreateProofSlot = makeRequestSlot('host_account_create_proof', async () => {
    const error = new CreateProofErr.Unknown({ reason: NOT_IMPLEMENTED });
    return enumValue('v1', resultErr(error));
  });

  // entropy derivation slot
  const handleDeriveEntropySlot = makeRequestSlot('host_derive_entropy', async () => {
    const error = new DeriveEntropyErr.Unknown({ reason: NOT_IMPLEMENTED });
    return enumValue('v1', resultErr(error));
  });

  // storage slots
  const handleLocalStorageReadSlot = makeRequestSlot('host_local_storage_read', async () => {
    const error = new StorageErr.Unknown({ reason: NOT_IMPLEMENTED });
    return enumValue('v1', resultErr(error));
  });

  const handleLocalStorageWriteSlot = makeRequestSlot('host_local_storage_write', async () => {
    const error = new StorageErr.Unknown({ reason: NOT_IMPLEMENTED });
    return enumValue('v1', resultErr(error));
  });

  const handleLocalStorageClearSlot = makeRequestSlot('host_local_storage_clear', async () => {
    const error = new StorageErr.Unknown({ reason: NOT_IMPLEMENTED });
    return enumValue('v1', resultErr(error));
  });

  // signing slots
  const handleSignRawSlot = makeRequestSlot('host_sign_raw', async () => {
    const error = new SigningErr.Unknown({ reason: NOT_IMPLEMENTED });
    return enumValue('v1', resultErr(error));
  });

  const handleSignPayloadSlot = makeRequestSlot('host_sign_payload', async () => {
    const error = new SigningErr.Unknown({ reason: NOT_IMPLEMENTED });
    return enumValue('v1', resultErr(error));
  });

  const handleCreateTransactionSlot = makeRequestSlot('host_create_transaction', async () => {
    const error = new CreateTransactionErr.Unknown({ reason: NOT_IMPLEMENTED });
    return enumValue('v1', resultErr(error));
  });

  const handleCreateTransactionWithNonProductAccountSlot = makeRequestSlot(
    'host_create_transaction_with_non_product_account',
    async () => {
      const error = new CreateTransactionErr.Unknown({ reason: NOT_IMPLEMENTED });
      return enumValue('v1', resultErr(error));
    },
  );

  const handleFeatureSupportedSlot = makeRequestSlot('host_feature_supported', async () => {
    const error = new GenericError({ reason: NOT_IMPLEMENTED });
    return enumValue('v1', resultErr(error));
  });

  const handleDevicePermissionSlot = makeRequestSlot('host_device_permission', async () => {
    const error = new GenericError({ reason: NOT_IMPLEMENTED });
    return enumValue('v1', resultErr(error));
  });

  const handleRemotePermissionSlot = makeRequestSlot('remote_permission', async () => {
    const error = new GenericError({ reason: NOT_IMPLEMENTED });
    return enumValue('v1', resultErr(error));
  });

  const handlePushNotificationSlot = makeRequestSlot('host_push_notification', async () => {
    const error = new GenericError({ reason: NOT_IMPLEMENTED });
    return enumValue('v1', resultErr(error));
  });

  const handleNavigateToSlot = makeRequestSlot('host_navigate_to', async () => {
    const error = new NavigateToErr.Unknown({ reason: NOT_IMPLEMENTED });
    return enumValue('v1', resultErr(error));
  });

  const handleChatCreateRoomSlot = makeRequestSlot('host_chat_create_room', async () => {
    const error = new ChatRoomRegistrationErr.Unknown({ reason: NOT_IMPLEMENTED });
    return enumValue('v1', resultErr(error));
  });

  const handleChatBotRegistrationSlot = makeRequestSlot('host_chat_register_bot', async () => {
    const error = new ChatBotRegistrationErr.Unknown({ reason: NOT_IMPLEMENTED });
    return enumValue('v1', resultErr(error));
  });

  const handleChatPostMessageSlot = makeRequestSlot('host_chat_post_message', async () => {
    const error = new ChatMessagePostingErr.Unknown({ reason: NOT_IMPLEMENTED });
    return enumValue('v1', resultErr(error));
  });

  const handleStatementStoreSubmitSlot = makeRequestSlot('remote_statement_store_submit', async () => {
    const error = new GenericError({ reason: NOT_IMPLEMENTED });
    return enumValue('v1', resultErr(error));
  });

  const handleStatementStoreCreateProofSlot = makeRequestSlot('remote_statement_store_create_proof', async () => {
    const error = new StatementProofErr.Unknown({ reason: NOT_IMPLEMENTED });
    return enumValue('v1', resultErr(error));
  });

  const handlePreimageSubmitSlot = makeRequestSlot('remote_preimage_submit', async () => {
    const error = new PreimageSubmitErr.Unknown({ reason: NOT_IMPLEMENTED });
    return enumValue('v1', resultErr(error));
  });

  // subscription slots — default interrupts on next microtask so that
  // the caller has a chance to register an onInterrupt listener first
  const handleAccountConnectionStatusSubscribeSlot = makeSubscriptionSlot(
    'host_account_connection_status_subscribe',
    (_params: unknown, _send: unknown, interrupt: VoidFunction) => {
      queueMicrotask(interrupt);
      return () => {
        /* nothing to clean up */
      };
    },
  );

  const handleChatListSubscribeSlot = makeSubscriptionSlot(
    'host_chat_list_subscribe',
    (_params: unknown, _send: unknown, interrupt: VoidFunction) => {
      queueMicrotask(interrupt);
      return () => {
        /* nothing to clean up */
      };
    },
  );

  const handleChatActionSubscribeSlot = makeSubscriptionSlot(
    'host_chat_action_subscribe',
    (_params: unknown, _send: unknown, interrupt: VoidFunction) => {
      queueMicrotask(interrupt);
      return () => {
        /* nothing to clean up */
      };
    },
  );

  const handleStatementStoreSubscribeSlot = makeSubscriptionSlot(
    'remote_statement_store_subscribe',
    (_params: unknown, _send: unknown, interrupt: VoidFunction) => {
      queueMicrotask(interrupt);
      return () => {
        /* nothing to clean up */
      };
    },
  );

  const handlePreimageLookupSubscribeSlot = makeSubscriptionSlot(
    'remote_preimage_lookup_subscribe',
    (_params: unknown, _send: unknown, interrupt: VoidFunction) => {
      queueMicrotask(interrupt);
      return () => {
        /* nothing to clean up */
      };
    },
  );

  return {
    handleFeatureSupported(handler) {
      init();
      return handleFeatureSupportedSlot.update(async message => {
        const version = 'v1';
        const error = new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(message, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleDevicePermission(handler) {
      init();
      return handleDevicePermissionSlot.update(async message => {
        const version = 'v1';
        const error = new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(message, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handlePermission(handler) {
      init();
      return handleRemotePermissionSlot.update(async message => {
        const version = 'v1';
        const error = new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(message, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handlePushNotification(handler) {
      init();
      return handlePushNotificationSlot.update(async message => {
        const version = 'v1';
        const error = new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(message, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleNavigateTo(handler) {
      init();
      return handleNavigateToSlot.update(async message => {
        const version = 'v1';
        const error = new NavigateToErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(message, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleDeriveEntropy(handler) {
      init();
      return handleDeriveEntropySlot.update(async message => {
        const version = 'v1';
        const error = new DeriveEntropyErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(message, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleLocalStorageRead(handler) {
      init();
      return handleLocalStorageReadSlot.update(async message => {
        const version = 'v1';
        const error = new StorageErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(message, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleLocalStorageWrite(handler) {
      init();
      return handleLocalStorageWriteSlot.update(async message => {
        const version = 'v1';
        const error = new StorageErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(message, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleLocalStorageClear(handler) {
      init();
      return handleLocalStorageClearSlot.update(async message => {
        const version = 'v1';
        const error = new StorageErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(message, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleAccountConnectionStatusSubscribe(handler) {
      init();
      return handleAccountConnectionStatusSubscribeSlot((params, send, interrupt) => {
        const version = 'v1';

        return guardVersion(params, version, null)
          .map(params => handler(params, payload => send(enumValue(version, payload)), interrupt))
          .orTee(interrupt)
          .unwrapOr(() => {
            /* empty */
          });
      });
    },

    handleAccountGet(handler) {
      init();
      return handleAccountGetSlot.update(async params => {
        const version = 'v1';
        const error = new RequestCredentialsErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(params, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleAccountGetAlias(handler) {
      init();
      return handleAccountGetAliasSlot.update(async params => {
        const version = 'v1';
        const error = new RequestCredentialsErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(params, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleAccountCreateProof(handler) {
      init();
      return handleAccountCreateProofSlot.update(async params => {
        const version = 'v1';
        const error = new CreateProofErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(params, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleGetNonProductAccounts(handler) {
      init();
      return handleGetNonProductAccountsSlot.update(async params => {
        const version = 'v1';
        const error = new RequestCredentialsErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(params, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleCreateTransaction(handler) {
      init();
      return handleCreateTransactionSlot.update(async params => {
        const version = 'v1';
        const error = new CreateTransactionErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(params, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleCreateTransactionWithNonProductAccount(handler) {
      init();
      return handleCreateTransactionWithNonProductAccountSlot.update(async params => {
        const version = 'v1';
        const error = new CreateTransactionErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(params, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleSignRaw(handler) {
      init();
      return handleSignRawSlot.update(async params => {
        const version = 'v1';
        const error = new SigningErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(params, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleSignPayload(handler) {
      init();
      return handleSignPayloadSlot.update(async params => {
        const version = 'v1';
        const error = new SigningErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(params, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleChatCreateRoom(handler) {
      init();
      return handleChatCreateRoomSlot.update(async params => {
        const version = 'v1';
        const error = new ChatRoomRegistrationErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(params, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleChatBotRegistration(handler) {
      init();
      return handleChatBotRegistrationSlot.update(async params => {
        const version = 'v1';
        const error = new ChatBotRegistrationErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(params, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleChatListSubscribe(handler) {
      init();
      return handleChatListSubscribeSlot((params, send, interrupt) => {
        const version = 'v1';

        return guardVersion(params, version, null)
          .map(params => handler(params, payload => send(enumValue(version, payload)), interrupt))
          .orTee(interrupt)
          .unwrapOr(() => {
            /* empty */
          });
      });
    },

    handleChatPostMessage(handler) {
      init();
      return handleChatPostMessageSlot.update(async params => {
        const version = 'v1';
        const error = new ChatMessagePostingErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(params, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleChatActionSubscribe(handler) {
      init();
      return handleChatActionSubscribeSlot((params, send, interrupt) => {
        const version = 'v1';

        return guardVersion(params, version, null)
          .map(params => handler(params, payload => send(enumValue(version, payload)), interrupt))
          .orTee(interrupt)
          .unwrapOr(() => {
            /* empty */
          });
      });
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
      init();
      return handleStatementStoreSubscribeSlot((params, send, interrupt) => {
        const version = 'v1';

        return guardVersion(params, version, null)
          .map(params => handler(params, payload => send(enumValue(version, payload)), interrupt))
          .orTee(interrupt)
          .unwrapOr(() => {
            /* empty */
          });
      });
    },

    handleStatementStoreCreateProof(handler) {
      init();
      return handleStatementStoreCreateProofSlot.update(async params => {
        const version = 'v1';
        const error = new StatementProofErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(params, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleStatementStoreSubmit(handler) {
      init();
      return handleStatementStoreSubmitSlot.update(async params => {
        const version = 'v1';
        const error = new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(params, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handlePreimageLookupSubscribe(handler) {
      init();
      return handlePreimageLookupSubscribeSlot((params, send, interrupt) => {
        const version = 'v1';

        return guardVersion(params, version, null)
          .map(params => handler(params, payload => send(enumValue(version, payload)), interrupt))
          .orTee(interrupt)
          .unwrapOr(() => {
            /* empty */
          });
      });
    },

    handlePreimageSubmit(handler) {
      init();
      return handlePreimageSubmitSlot.update(async params => {
        const version = 'v1';
        const error = new PreimageSubmitErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(params, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
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
            send(enumValue('v1', typedEvent) as any);
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
