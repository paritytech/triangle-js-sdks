import type { ConnectionStatus, Provider } from '@novasamatech/host-api';
import {
  ChatBotRegistrationErr,
  ChatMessagePostingErr,
  ChatRoomRegistrationErr,
  CreateProofErr,
  CreateTransactionErr,
  GenericError,
  RequestCredentialsErr,
  SigningErr,
  StatementProofErr,
  StorageErr,
  assertEnumVariant,
  createTransport,
  enumValue,
  isEnumVariant,
  resultErr,
  resultOk,
} from '@novasamatech/host-api';
import type { Result } from 'neverthrow';
import { err, errAsync, ok, okAsync } from 'neverthrow';

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
    handleFeature(handler) {
      init();
      return transport.handleRequest('feature', async message => {
        const version = 'v1';
        const error = new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(message, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleLocalStorageRead(handler) {
      init();
      return transport.handleRequest('local_storage_read', async message => {
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
      return transport.handleRequest('local_storage_write', async message => {
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
      return transport.handleRequest('local_storage_clear', async params => {
        const version = 'v1';
        const error = new StorageErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(params, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleAccountGet(handler) {
      init();
      return transport.handleRequest('account_get', async params => {
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
      return transport.handleRequest('account_get_alias', async params => {
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
      return transport.handleRequest('account_create_proof', async params => {
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
      return transport.handleRequest('get_non_product_accounts', async params => {
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
      return transport.handleRequest('create_transaction', async params => {
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
      return transport.handleRequest('create_transaction_with_non_product_account', async params => {
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
      return transport.handleRequest('sign_raw', async params => {
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
      return transport.handleRequest('sign_payload', async params => {
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
      return transport.handleRequest('chat_create_room', async params => {
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
      return transport.handleRequest('chat_register_bot', async params => {
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
      return transport.handleSubscription('chat_list_subscribe', (params, send, interrupt) => {
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
      return transport.handleRequest('chat_post_message', async params => {
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
      return transport.handleSubscription('chat_action_subscribe', (params, send, interrupt) => {
        const version = 'v1';

        return guardVersion(params, version, null)
          .map(params => handler(params, payload => send(enumValue(version, payload)), interrupt))
          .orTee(interrupt)
          .unwrapOr(() => {
            /* empty */
          });
      });
    },

    handleStatementStoreQuery(handler) {
      init();
      return transport.handleRequest('statement_store_query', async params => {
        const version = 'v1';
        const error = new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(params, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleStatementStoreSubscribe(handler) {
      init();
      return transport.handleSubscription('statement_store_subscribe', (params, send, interrupt) => {
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
      return transport.handleRequest('statement_store_create_proof', async params => {
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
      return transport.handleRequest('statement_store_submit', async params => {
        const version = 'v1';
        const error = new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });

        return guardVersion(params, version, error)
          .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(r => enumValue(version, resultOk(r))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)));
      });
    },

    handleChainConnection(factory) {
      init();
      return transport.handleSubscription('jsonrpc_message_subscribe', (params, send) => {
        assertEnumVariant(params, 'v1', UNSUPPORTED_MESSAGE_FORMAT_ERROR);

        const genesisHash = params.value;
        const provider = factory(params.value);

        if (provider === null) {
          return () => {
            // empty subscription, we don't want to react to foreign chain subscription request
          };
        }

        const connection = provider(message => send(enumValue('v1', message)));

        const unsubscribeDestroy = transport.onDestroy(() => {
          unsubRequests();
          unsubscribeDestroy();
          connection.disconnect();
        });

        const unsubRequests = transport.handleRequest('jsonrpc_message_send', async message => {
          assertEnumVariant(message, 'v1', UNSUPPORTED_MESSAGE_FORMAT_ERROR);
          const [requestedGenesisHash, payload] = message.value;
          if (requestedGenesisHash === genesisHash) {
            connection.send(payload);
          }
          return enumValue('v1', resultOk(undefined));
        });

        return () => {
          unsubRequests();
          unsubscribeDestroy();
          connection.disconnect();
        };
      });
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
