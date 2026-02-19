import type { ConnectionStatus, Provider } from '@novasamatech/host-api';
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
  assertEnumVariant,
  createTransport,
  enumValue,
  isEnumVariant,
  resultErr,
  resultOk,
} from '@novasamatech/host-api';
import { toastError } from '@novasamatech/tr-ui';
import type { Result } from 'neverthrow';
import { err, errAsync, ok, okAsync } from 'neverthrow';

import type { RateLimiterConfig, TokenBucketRateLimiter } from './rateLimiter.js';
import { RateLimiterError, createTokenBucketRateLimiter } from './rateLimiter.js';
import type { Container } from './types.js';

const UNSUPPORTED_MESSAGE_FORMAT_ERROR = 'Unsupported message format';
const RATE_LIMITED_ERROR_REASON = 'Request rate limited';
const RATE_LIMITER_QUEUE_TIMEOUT_REASON = 'Request timed out in rate limiter queue';

const RATE_LIMITER_CONFIG: RateLimiterConfig = {
  maxRequestsPerInterval: 20,
  intervalMs: 1000,
  maxQueuedRequests: 100,
  maxQueueDelayMs: 10000,
};

function getRateLimiterErrorReason(e: RateLimiterError): string {
  return e.code === 'rate_limited' ? RATE_LIMITED_ERROR_REASON : RATE_LIMITER_QUEUE_TIMEOUT_REASON;
}

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

  const rateLimiters = new Map<string, TokenBucketRateLimiter>();

  function getRateLimiter(method: string): TokenBucketRateLimiter {
    let limiter = rateLimiters.get(method);
    if (!limiter) {
      limiter = createTokenBucketRateLimiter(RATE_LIMITER_CONFIG);
      rateLimiters.set(method, limiter);
    }
    return limiter;
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
        try {
          return await getRateLimiter('host_feature_supported').schedule(() =>
            guardVersion(message, version, error)
              .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
              .andThen(r => r.map(r => enumValue(version, resultOk(r))))
              .orElse(r => ok(enumValue(version, resultErr(r))))
              .unwrapOr(enumValue(version, resultErr(error))),
          );
        } catch (e) {
          if (e instanceof RateLimiterError) {
            console.error(e.code);
            const reason = getRateLimiterErrorReason(e);
            toastError({ title: reason });
            return enumValue(version, resultErr(new GenericError({ reason })));
          }
          throw e;
        }
      });
    },

    handleDevicePermission(handler) {
      init();
      return transport.handleRequest('host_device_permission', async message => {
        const version = 'v1';
        const error = new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });
        try {
          return await getRateLimiter('host_device_permission').schedule(() =>
            guardVersion(message, version, error)
              .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
              .andThen(r => r.map(r => enumValue(version, resultOk(r))))
              .orElse(r => ok(enumValue(version, resultErr(r))))
              .unwrapOr(enumValue(version, resultErr(error))),
          );
        } catch (e) {
          if (e instanceof RateLimiterError) {
            console.error(e.code);
            const reason = getRateLimiterErrorReason(e);
            toastError({ title: reason });
            return enumValue(version, resultErr(new GenericError({ reason })));
          }
          throw e;
        }
      });
    },

    handlePermission(handler) {
      init();
      return transport.handleRequest('remote_permission', async message => {
        const version = 'v1';
        const error = new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });
        try {
          return await getRateLimiter('remote_permission').schedule(() =>
            guardVersion(message, version, error)
              .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
              .andThen(r => r.map(r => enumValue(version, resultOk(r))))
              .orElse(r => ok(enumValue(version, resultErr(r))))
              .unwrapOr(enumValue(version, resultErr(error))),
          );
        } catch (e) {
          if (e instanceof RateLimiterError) {
            console.error(e.code);
            const reason = getRateLimiterErrorReason(e);
            toastError({ title: reason });
            return enumValue(version, resultErr(new GenericError({ reason })));
          }
          throw e;
        }
      });
    },

    handlePushNotification(handler) {
      init();
      return transport.handleRequest('host_push_notification', async message => {
        const version = 'v1';
        const error = new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });
        try {
          return await getRateLimiter('host_push_notification').schedule(() =>
            guardVersion(message, version, error)
              .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
              .andThen(r => r.map(r => enumValue(version, resultOk(r))))
              .orElse(r => ok(enumValue(version, resultErr(r))))
              .unwrapOr(enumValue(version, resultErr(error))),
          );
        } catch (e) {
          if (e instanceof RateLimiterError) {
            console.error(e.code);
            const reason = getRateLimiterErrorReason(e);
            toastError({ title: reason });
            return enumValue(version, resultErr(new GenericError({ reason })));
          }
          throw e;
        }
      });
    },

    handleNavigateTo(handler) {
      init();
      return transport.handleRequest('host_navigate_to', async message => {
        const version = 'v1';
        const error = new NavigateToErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });
        try {
          return await getRateLimiter('host_navigate_to').schedule(() =>
            guardVersion(message, version, error)
              .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
              .andThen(r => r.map(r => enumValue(version, resultOk(r))))
              .orElse(r => ok(enumValue(version, resultErr(r))))
              .unwrapOr(enumValue(version, resultErr(error))),
          );
        } catch (e) {
          if (e instanceof RateLimiterError) {
            console.error(e.code);
            const reason = getRateLimiterErrorReason(e);
            toastError({ title: reason });
            return enumValue(version, resultErr(new NavigateToErr.Unknown({ reason })));
          }
          throw e;
        }
      });
    },

    handleLocalStorageRead(handler) {
      init();
      return transport.handleRequest('host_local_storage_read', async message => {
        const version = 'v1';
        const error = new StorageErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });
        try {
          return await getRateLimiter('host_local_storage_read').schedule(() =>
            guardVersion(message, version, error)
              .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
              .andThen(r => r.map(r => enumValue(version, resultOk(r))))
              .orElse(r => ok(enumValue(version, resultErr(r))))
              .unwrapOr(enumValue(version, resultErr(error))),
          );
        } catch (e) {
          if (e instanceof RateLimiterError) {
            console.error(e.code);
            const reason = getRateLimiterErrorReason(e);
            toastError({ title: reason });
            return enumValue(version, resultErr(new StorageErr.Unknown({ reason })));
          }
          throw e;
        }
      });
    },

    handleLocalStorageWrite(handler) {
      init();
      return transport.handleRequest('host_local_storage_write', async message => {
        const version = 'v1';
        const error = new StorageErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });
        try {
          return await getRateLimiter('host_local_storage_write').schedule(() =>
            guardVersion(message, version, error)
              .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
              .andThen(r => r.map(r => enumValue(version, resultOk(r))))
              .orElse(r => ok(enumValue(version, resultErr(r))))
              .unwrapOr(enumValue(version, resultErr(error))),
          );
        } catch (e) {
          if (e instanceof RateLimiterError) {
            console.error(e.code);
            const reason = getRateLimiterErrorReason(e);
            toastError({ title: reason });
            return enumValue(version, resultErr(new StorageErr.Unknown({ reason })));
          }
          throw e;
        }
      });
    },

    handleLocalStorageClear(handler) {
      init();
      return transport.handleRequest('host_local_storage_clear', async params => {
        const version = 'v1';
        const error = new StorageErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });
        try {
          return await getRateLimiter('host_local_storage_clear').schedule(() =>
            guardVersion(params, version, error)
              .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
              .andThen(r => r.map(r => enumValue(version, resultOk(r))))
              .orElse(r => ok(enumValue(version, resultErr(r))))
              .unwrapOr(enumValue(version, resultErr(error))),
          );
        } catch (e) {
          if (e instanceof RateLimiterError) {
            console.error(e.code);
            const reason = getRateLimiterErrorReason(e);
            toastError({ title: reason });
            return enumValue(version, resultErr(new StorageErr.Unknown({ reason })));
          }
          throw e;
        }
      });
    },

    handleAccountGet(handler) {
      init();
      return transport.handleRequest('host_account_get', async params => {
        const version = 'v1';
        const error = new RequestCredentialsErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });
        try {
          return await getRateLimiter('host_account_get').schedule(() =>
            guardVersion(params, version, error)
              .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
              .andThen(r => r.map(r => enumValue(version, resultOk(r))))
              .orElse(r => ok(enumValue(version, resultErr(r))))
              .unwrapOr(enumValue(version, resultErr(error))),
          );
        } catch (e) {
          if (e instanceof RateLimiterError) {
            console.error(e.code);
            const reason = getRateLimiterErrorReason(e);
            toastError({ title: reason });
            return enumValue(version, resultErr(new RequestCredentialsErr.Unknown({ reason })));
          }
          throw e;
        }
      });
    },

    handleAccountGetAlias(handler) {
      init();
      return transport.handleRequest('host_account_get_alias', async params => {
        const version = 'v1';
        const error = new RequestCredentialsErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });
        try {
          return await getRateLimiter('host_account_get_alias').schedule(() =>
            guardVersion(params, version, error)
              .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
              .andThen(r => r.map(r => enumValue(version, resultOk(r))))
              .orElse(r => ok(enumValue(version, resultErr(r))))
              .unwrapOr(enumValue(version, resultErr(error))),
          );
        } catch (e) {
          if (e instanceof RateLimiterError) {
            console.error(e.code);
            const reason = getRateLimiterErrorReason(e);
            toastError({ title: reason });
            return enumValue(version, resultErr(new RequestCredentialsErr.Unknown({ reason })));
          }
          throw e;
        }
      });
    },

    handleAccountCreateProof(handler) {
      init();
      return transport.handleRequest('host_account_create_proof', async params => {
        const version = 'v1';
        const error = new CreateProofErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });
        try {
          return await getRateLimiter('host_account_create_proof').schedule(() =>
            guardVersion(params, version, error)
              .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
              .andThen(r => r.map(r => enumValue(version, resultOk(r))))
              .orElse(r => ok(enumValue(version, resultErr(r))))
              .unwrapOr(enumValue(version, resultErr(error))),
          );
        } catch (e) {
          if (e instanceof RateLimiterError) {
            console.error(e.code);
            const reason = getRateLimiterErrorReason(e);
            toastError({ title: reason });
            return enumValue(version, resultErr(new CreateProofErr.Unknown({ reason })));
          }
          throw e;
        }
      });
    },

    handleGetNonProductAccounts(handler) {
      init();
      return transport.handleRequest('host_get_non_product_accounts', async params => {
        const version = 'v1';
        const error = new RequestCredentialsErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });
        try {
          return await getRateLimiter('host_get_non_product_accounts').schedule(() =>
            guardVersion(params, version, error)
              .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
              .andThen(r => r.map(r => enumValue(version, resultOk(r))))
              .orElse(r => ok(enumValue(version, resultErr(r))))
              .unwrapOr(enumValue(version, resultErr(error))),
          );
        } catch (e) {
          if (e instanceof RateLimiterError) {
            console.error(e.code);
            const reason = getRateLimiterErrorReason(e);
            toastError({ title: reason });
            return enumValue(version, resultErr(new RequestCredentialsErr.Unknown({ reason })));
          }
          throw e;
        }
      });
    },

    handleCreateTransaction(handler) {
      init();
      return transport.handleRequest('host_create_transaction', async params => {
        const version = 'v1';
        const error = new CreateTransactionErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });
        try {
          return await getRateLimiter('host_create_transaction').schedule(() =>
            guardVersion(params, version, error)
              .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
              .andThen(r => r.map(r => enumValue(version, resultOk(r))))
              .orElse(r => ok(enumValue(version, resultErr(r))))
              .unwrapOr(enumValue(version, resultErr(error))),
          );
        } catch (e) {
          if (e instanceof RateLimiterError) {
            console.error(e.code);
            const reason = getRateLimiterErrorReason(e);
            toastError({ title: reason });
            return enumValue(version, resultErr(new CreateTransactionErr.Unknown({ reason })));
          }
          throw e;
        }
      });
    },

    handleCreateTransactionWithNonProductAccount(handler) {
      init();
      return transport.handleRequest('host_create_transaction_with_non_product_account', async params => {
        const version = 'v1';
        const error = new CreateTransactionErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });
        try {
          return await getRateLimiter('host_create_transaction_with_non_product_account').schedule(() =>
            guardVersion(params, version, error)
              .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
              .andThen(r => r.map(r => enumValue(version, resultOk(r))))
              .orElse(r => ok(enumValue(version, resultErr(r))))
              .unwrapOr(enumValue(version, resultErr(error))),
          );
        } catch (e) {
          if (e instanceof RateLimiterError) {
            console.error(e.code);
            const reason = getRateLimiterErrorReason(e);
            toastError({ title: reason });
            return enumValue(version, resultErr(new CreateTransactionErr.Unknown({ reason })));
          }
          throw e;
        }
      });
    },

    handleSignRaw(handler) {
      init();
      return transport.handleRequest('host_sign_raw', async params => {
        const version = 'v1';
        const error = new SigningErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });
        try {
          return await getRateLimiter('host_sign_raw').schedule(() =>
            guardVersion(params, version, error)
              .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
              .andThen(r => r.map(r => enumValue(version, resultOk(r))))
              .orElse(r => ok(enumValue(version, resultErr(r))))
              .unwrapOr(enumValue(version, resultErr(error))),
          );
        } catch (e) {
          if (e instanceof RateLimiterError) {
            console.error(e.code);
            const reason = getRateLimiterErrorReason(e);
            toastError({ title: reason });
            return enumValue(version, resultErr(new SigningErr.Unknown({ reason })));
          }
          throw e;
        }
      });
    },

    handleSignPayload(handler) {
      init();
      return transport.handleRequest('host_sign_payload', async params => {
        const version = 'v1';
        const error = new SigningErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });
        try {
          return await getRateLimiter('host_sign_payload').schedule(() =>
            guardVersion(params, version, error)
              .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
              .andThen(r => r.map(r => enumValue(version, resultOk(r))))
              .orElse(r => ok(enumValue(version, resultErr(r))))
              .unwrapOr(enumValue(version, resultErr(error))),
          );
        } catch (e) {
          if (e instanceof RateLimiterError) {
            console.error(e.code);
            const reason = getRateLimiterErrorReason(e);
            toastError({ title: reason });
            return enumValue(version, resultErr(new SigningErr.Unknown({ reason })));
          }
          throw e;
        }
      });
    },

    handleChatCreateRoom(handler) {
      init();
      return transport.handleRequest('host_chat_create_room', async params => {
        const version = 'v1';
        const error = new ChatRoomRegistrationErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });
        try {
          return await getRateLimiter('host_chat_create_room').schedule(() =>
            guardVersion(params, version, error)
              .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
              .andThen(r => r.map(r => enumValue(version, resultOk(r))))
              .orElse(r => ok(enumValue(version, resultErr(r))))
              .unwrapOr(enumValue(version, resultErr(error))),
          );
        } catch (e) {
          if (e instanceof RateLimiterError) {
            console.error(e.code);
            const reason = getRateLimiterErrorReason(e);
            toastError({ title: reason });
            return enumValue(version, resultErr(new ChatRoomRegistrationErr.Unknown({ reason })));
          }
          throw e;
        }
      });
    },

    handleChatBotRegistration(handler) {
      init();
      return transport.handleRequest('host_chat_register_bot', async params => {
        const version = 'v1';
        const error = new ChatBotRegistrationErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });
        try {
          return await getRateLimiter('host_chat_register_bot').schedule(() =>
            guardVersion(params, version, error)
              .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
              .andThen(r => r.map(r => enumValue(version, resultOk(r))))
              .orElse(r => ok(enumValue(version, resultErr(r))))
              .unwrapOr(enumValue(version, resultErr(error))),
          );
        } catch (e) {
          if (e instanceof RateLimiterError) {
            console.error(e.code);
            const reason = getRateLimiterErrorReason(e);
            toastError({ title: reason });
            return enumValue(version, resultErr(new ChatBotRegistrationErr.Unknown({ reason })));
          }
          throw e;
        }
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
        try {
          return await getRateLimiter('host_chat_post_message').schedule(() =>
            guardVersion(params, version, error)
              .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
              .andThen(r => r.map(r => enumValue(version, resultOk(r))))
              .orElse(r => ok(enumValue(version, resultErr(r))))
              .unwrapOr(enumValue(version, resultErr(error))),
          );
        } catch (e) {
          if (e instanceof RateLimiterError) {
            console.error(e.code);
            const reason = getRateLimiterErrorReason(e);
            toastError({ title: reason });
            return enumValue(version, resultErr(new ChatMessagePostingErr.Unknown({ reason })));
          }
          throw e;
        }
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
        try {
          return await getRateLimiter('remote_statement_store_create_proof').schedule(() =>
            guardVersion(params, version, error)
              .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
              .andThen(r => r.map(r => enumValue(version, resultOk(r))))
              .orElse(r => ok(enumValue(version, resultErr(r))))
              .unwrapOr(enumValue(version, resultErr(error))),
          );
        } catch (e) {
          if (e instanceof RateLimiterError) {
            console.error(e.code);
            const reason = getRateLimiterErrorReason(e);
            toastError({ title: reason });
            return enumValue(version, resultErr(new StatementProofErr.Unknown({ reason })));
          }
          throw e;
        }
      });
    },

    handleStatementStoreSubmit(handler) {
      init();
      return transport.handleRequest('remote_statement_store_submit', async params => {
        const version = 'v1';
        const error = new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR });
        try {
          return await getRateLimiter('remote_statement_store_submit').schedule(() =>
            guardVersion(params, version, error)
              .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
              .andThen(r => r.map(r => enumValue(version, resultOk(r))))
              .orElse(r => ok(enumValue(version, resultErr(r))))
              .unwrapOr(enumValue(version, resultErr(error))),
          );
        } catch (e) {
          if (e instanceof RateLimiterError) {
            console.error(e.code);
            const reason = getRateLimiterErrorReason(e);
            toastError({ title: reason });
            return enumValue(version, resultErr(new GenericError({ reason })));
          }
          throw e;
        }
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
        try {
          return await getRateLimiter('remote_preimage_submit').schedule(() =>
            guardVersion(params, version, error)
              .asyncMap(async params => handler(params, { ok: okAsync<any>, err: errAsync<never, any> }))
              .andThen(r => r.map(r => enumValue(version, resultOk(r))))
              .orElse(r => ok(enumValue(version, resultErr(r))))
              .unwrapOr(enumValue(version, resultErr(error))),
          );
        } catch (e) {
          if (e instanceof RateLimiterError) {
            console.error(e.code);
            const reason = getRateLimiterErrorReason(e);
            toastError({ title: reason });
            return enumValue(version, resultErr(new PreimageSubmitErr.Unknown({ reason })));
          }
          throw e;
        }
      });
    },

    handleChainConnection(factory) {
      init();
      return transport.handleSubscription('host_jsonrpc_message_subscribe', (params, send) => {
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

        const unsubRequests = transport.handleRequest('host_jsonrpc_message_send', async message => {
          assertEnumVariant(message, 'v1', UNSUPPORTED_MESSAGE_FORMAT_ERROR);
          const [requestedGenesisHash, payload] = message.value;

          if (requestedGenesisHash !== genesisHash) {
            return enumValue('v1', resultOk(undefined));
          }

          try {
            return await getRateLimiter('host_jsonrpc_message_send').schedule(() => {
              connection.send(payload);
              return enumValue('v1', resultOk(undefined));
            });
          } catch (error) {
            if (error instanceof RateLimiterError) {
              const reason = getRateLimiterErrorReason(error);
              return enumValue('v1', resultErr(new GenericError({ reason })));
            }

            const reason = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
            return enumValue('v1', resultErr(new GenericError({ reason })));
          }
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
      rateLimiters.forEach(limiter => limiter.destroy());
      rateLimiters.clear();
      transport.destroy();
    },
  };
}
