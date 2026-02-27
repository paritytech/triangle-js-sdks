import type { ConnectionStatus, HexString, Provider } from '@novasamatech/host-api';
import {
  ChatBotRegistrationErr,
  ChatMessagePostingErr,
  ChatRoomRegistrationErr,
  CreateProofErr,
  CreateTransactionErr,
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

  return {
    handleFeatureSupported(handler) {
      init();
      return transport.handleRequest('host_feature_supported', async message => {
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
      return transport.handleRequest('host_device_permission', async message => {
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
      return transport.handleRequest('remote_permission', async message => {
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
      return transport.handleRequest('host_push_notification', async message => {
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
      return transport.handleRequest('host_navigate_to', async message => {
        const version = 'v1';
        const error = new NavigateToErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(message, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleLocalStorageRead(handler) {
      init();
      return transport.handleRequest('host_local_storage_read', async message => {
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
      return transport.handleRequest('host_local_storage_write', async message => {
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
      return transport.handleRequest('host_local_storage_clear', async params => {
        const version = 'v1';
        const error = new StorageErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(params, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleAccountConnectionStatusSubscribe(handler) {
      init();
      return transport.handleSubscription('host_account_connection_status_subscribe', (params, send, interrupt) => {
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
      return transport.handleRequest('host_account_get', async params => {
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
      return transport.handleRequest('host_account_get_alias', async params => {
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
      return transport.handleRequest('host_account_create_proof', async params => {
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
      return transport.handleRequest('host_get_non_product_accounts', async params => {
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
      return transport.handleRequest('host_create_transaction', async params => {
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
      return transport.handleRequest('host_create_transaction_with_non_product_account', async params => {
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
      return transport.handleRequest('host_sign_raw', async params => {
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
      return transport.handleRequest('host_sign_payload', async params => {
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
      return transport.handleRequest('host_chat_create_room', async params => {
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
      return transport.handleRequest('host_chat_register_bot', async params => {
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
      return transport.handleSubscription('host_chat_list_subscribe', (params, send, interrupt) => {
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
      return transport.handleRequest('host_chat_post_message', async params => {
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
      return transport.handleSubscription('host_chat_action_subscribe', (params, send, interrupt) => {
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
      return transport.handleSubscription('remote_statement_store_subscribe', (params, send, interrupt) => {
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
      return transport.handleRequest('remote_statement_store_create_proof', async params => {
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
      return transport.handleRequest('remote_statement_store_submit', async params => {
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
      return transport.handleSubscription('remote_preimage_lookup_subscribe', (params, send, interrupt) => {
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
      return transport.handleRequest('remote_preimage_submit', async params => {
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

          const entry = manager.getOrCreateChain(genesisHash);
          if (!entry) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'Chain not supported' })));
          }

          try {
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
