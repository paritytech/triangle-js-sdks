import type { ResultAsync } from 'neverthrow';
import { errAsync, fromPromise, okAsync } from 'neverthrow';
import type { Codec, CodecType } from 'scale-ts';

import { extractErrorMessage } from './helpers.js';
import { GenericError } from './protocol/commonCodecs.js';
import type { HostApiProtocol, VersionedProtocolRequest, VersionedProtocolSubscription } from './protocol/impl.js';
import { CreateProofErr, RequestCredentialsErr } from './protocol/v1/accounts.js';
import { ChatBotRegistrationErr, ChatMessagePostingErr, ChatRoomRegistrationErr } from './protocol/v1/chat.js';
import { CreateTransactionErr } from './protocol/v1/createTransaction.js';
import { HandshakeErr } from './protocol/v1/handshake.js';
import { SigningErr } from './protocol/v1/sign.js';
import { StatementProofErr } from './protocol/v1/statementStore.js';
import { StorageErr } from './protocol/v1/storage.js';
import type { Subscription, Transport } from './types.js';

type SnakeToCamelCase<S extends string> = S extends `${infer T}_${infer U}`
  ? `${T}${Capitalize<SnakeToCamelCase<U>>}`
  : S;

type StripNamespace<S extends string> = S extends `host_${infer Rest}`
  ? Rest
  : S extends `remote_${infer Rest}`
    ? Rest
    : S;

type Value<T extends Codec<any> | Codec<never>> = T extends Codec<any> ? CodecType<T> : unknown;

type UnwrapVersionedResult<T> = T extends { tag: infer Tag; value: infer Value }
  ? ResultAsync<
      {
        tag: Tag;
        value: SuccessResponse<Value>;
      },
      {
        tag: Tag;
        value: ErrorResponse<Value>;
      }
    >
  : never;

type SuccessResponse<T> = T extends { success: true; value: infer U } ? U : never;
type ErrorResponse<T> = T extends { success: false; value: infer U } ? U : never;

type InferRequestMethod<Method extends VersionedProtocolRequest> = (
  args: Value<Method['request']>,
) => UnwrapVersionedResult<Value<Method['response']>>;

type InferSubscribeMethod<Method extends VersionedProtocolSubscription> = (
  args: Value<Method['start']>,
  callback: (payload: Value<Method['receive']>) => void,
) => Subscription;

type InferMethod<Method extends VersionedProtocolRequest | VersionedProtocolSubscription> =
  Method extends VersionedProtocolRequest
    ? InferRequestMethod<Method>
    : Method extends VersionedProtocolSubscription
      ? InferSubscribeMethod<Method>
      : never;

export type HostApi = {
  [K in keyof HostApiProtocol as SnakeToCamelCase<StripNamespace<K>>]: InferMethod<HostApiProtocol[K]>;
};

export function createHostApi(transport: Transport): HostApi {
  return {
    handshake(payload) {
      const response = fromPromise(transport.request('host_handshake', payload), e => ({
        tag: payload.tag,
        value: new HandshakeErr.Unknown({ reason: extractErrorMessage(e) }),
      }));

      return response.andThen(response => {
        if (response.value.success) {
          return okAsync({
            tag: response.tag,
            value: response.value.value,
          });
        }

        return errAsync({
          tag: response.tag,
          value: response.value.value,
        });
      });
    },
    featureSupported(payload) {
      const response = fromPromise(transport.request('host_feature_supported', payload), e => ({
        tag: payload.tag,
        value: new GenericError({ reason: extractErrorMessage(e) }),
      }));

      return response.andThen(response => {
        if (response.value.success) {
          return okAsync({
            tag: response.tag,
            value: response.value.value,
          });
        }

        return errAsync({
          tag: response.tag,
          value: response.value.value,
        });
      });
    },

    devicePermission(payload) {
      const response = fromPromise(transport.request('host_device_permission', payload), e => ({
        tag: payload.tag,
        value: new GenericError({ reason: extractErrorMessage(e) }),
      }));

      return response.andThen(response => {
        if (response.value.success) {
          return okAsync({
            tag: response.tag,
            value: response.value.value,
          });
        }

        return errAsync({
          tag: response.tag,
          value: response.value.value,
        });
      });
    },

    pushNotification(payload) {
      const response = fromPromise(transport.request('host_push_notification', payload), e => ({
        tag: payload.tag,
        value: new GenericError({ reason: extractErrorMessage(e) }),
      }));

      return response.andThen(response => {
        if (response.value.success) {
          return okAsync({
            tag: response.tag,
            value: response.value.value,
          });
        }

        return errAsync({
          tag: response.tag,
          value: response.value.value,
        });
      });
    },

    localStorageRead(payload) {
      const response = fromPromise(transport.request('host_local_storage_read', payload), e => ({
        tag: payload.tag,
        value: new StorageErr.Unknown({ reason: extractErrorMessage(e) }),
      }));

      return response.andThen(response => {
        if (response.value.success) {
          return okAsync({
            tag: response.tag,
            value: response.value.value,
          });
        }

        return errAsync({
          tag: response.tag,
          value: response.value.value,
        });
      });
    },

    localStorageWrite(payload) {
      const response = fromPromise(transport.request('host_local_storage_write', payload), e => ({
        tag: payload.tag,
        value: new StorageErr.Unknown({ reason: extractErrorMessage(e) }),
      }));

      return response.andThen(response => {
        if (response.value.success) {
          return okAsync({
            tag: response.tag,
            value: response.value.value,
          });
        }

        return errAsync({
          tag: response.tag,
          value: response.value.value,
        });
      });
    },

    localStorageClear(payload) {
      const response = fromPromise(transport.request('host_local_storage_clear', payload), e => ({
        tag: payload.tag,
        value: new StorageErr.Unknown({ reason: extractErrorMessage(e) }),
      }));

      return response.andThen(response => {
        if (response.value.success) {
          return okAsync({
            tag: response.tag,
            value: response.value.value,
          });
        }

        return errAsync({
          tag: response.tag,
          value: response.value.value,
        });
      });
    },

    accountGet(payload) {
      const response = fromPromise(transport.request('host_account_get', payload), e => ({
        tag: payload.tag,
        value: new RequestCredentialsErr.Unknown({ reason: extractErrorMessage(e) }),
      }));

      return response.andThen(response => {
        if (response.value.success) {
          return okAsync({
            tag: response.tag,
            value: response.value.value,
          });
        }

        return errAsync({
          tag: response.tag,
          value: response.value.value,
        });
      });
    },

    accountGetAlias(payload) {
      const response = fromPromise(transport.request('host_account_get_alias', payload), e => ({
        tag: payload.tag,
        value: new RequestCredentialsErr.Unknown({ reason: extractErrorMessage(e) }),
      }));

      return response.andThen(response => {
        if (response.value.success) {
          return okAsync({
            tag: response.tag,
            value: response.value.value,
          });
        }

        return errAsync({
          tag: response.tag,
          value: response.value.value,
        });
      });
    },

    accountCreateProof(payload) {
      const response = fromPromise(transport.request('host_account_create_proof', payload), e => ({
        tag: payload.tag,
        value: new CreateProofErr.Unknown({ reason: extractErrorMessage(e) }),
      }));

      return response.andThen(response => {
        if (response.value.success) {
          return okAsync({
            tag: response.tag,
            value: response.value.value,
          });
        }

        return errAsync({
          tag: response.tag,
          value: response.value.value,
        });
      });
    },

    getNonProductAccounts(payload) {
      const response = fromPromise(transport.request('host_get_non_product_accounts', payload), e => ({
        tag: payload.tag,
        value: new RequestCredentialsErr.Unknown({ reason: extractErrorMessage(e) }),
      }));

      return response.andThen(response => {
        if (response.value.success) {
          return okAsync({
            tag: response.tag,
            value: response.value.value,
          });
        }

        return errAsync({
          tag: response.tag,
          value: response.value.value,
        });
      });
    },

    createTransaction(payload) {
      const response = fromPromise(transport.request('host_create_transaction', payload), e => ({
        tag: payload.tag,
        value: new CreateTransactionErr.Unknown({ reason: extractErrorMessage(e) }),
      }));

      return response.andThen(response => {
        if (response.value.success) {
          return okAsync({
            tag: response.tag,
            value: response.value.value,
          });
        }

        return errAsync({
          tag: response.tag,
          value: response.value.value,
        });
      });
    },

    createTransactionWithNonProductAccount(payload) {
      const response = fromPromise(
        transport.request('host_create_transaction_with_non_product_account', payload),
        e => ({
          tag: payload.tag,
          value: new CreateTransactionErr.Unknown({ reason: extractErrorMessage(e) }),
        }),
      );

      return response.andThen(response => {
        if (response.value.success) {
          return okAsync({
            tag: response.tag,
            value: response.value.value,
          });
        }

        return errAsync({
          tag: response.tag,
          value: response.value.value,
        });
      });
    },

    signRaw(payload) {
      const response = fromPromise(transport.request('host_sign_raw', payload), e => ({
        tag: payload.tag,
        value: new SigningErr.Unknown({ reason: extractErrorMessage(e) }),
      }));

      return response.andThen(response => {
        if (response.value.success) {
          return okAsync({
            tag: response.tag,
            value: response.value.value,
          });
        }

        return errAsync({
          tag: response.tag,
          value: response.value.value,
        });
      });
    },

    signPayload(payload) {
      const response = fromPromise(transport.request('host_sign_payload', payload), e => ({
        tag: payload.tag,
        value: new SigningErr.Unknown({ reason: extractErrorMessage(e) }),
      }));

      return response.andThen(response => {
        if (response.value.success) {
          return okAsync({
            tag: response.tag,
            value: response.value.value,
          });
        }

        return errAsync({
          tag: response.tag,
          value: response.value.value,
        });
      });
    },

    chatListSubscribe(args, callback) {
      return transport.subscribe('host_chat_list_subscribe', args, callback);
    },

    chatCreateRoom(payload) {
      const response = fromPromise(transport.request('host_chat_create_room', payload), e => ({
        tag: payload.tag,
        value: new ChatRoomRegistrationErr.Unknown({ reason: extractErrorMessage(e) }),
      }));

      return response.andThen(response => {
        if (response.value.success) {
          return okAsync({
            tag: response.tag,
            value: response.value.value,
          });
        }

        return errAsync({
          tag: response.tag,
          value: response.value.value,
        });
      });
    },

    chatRegisterBot(payload) {
      const response = fromPromise(transport.request('host_chat_register_bot', payload), e => ({
        tag: payload.tag,
        value: new ChatBotRegistrationErr.Unknown({ reason: extractErrorMessage(e) }),
      }));

      return response.andThen(response => {
        if (response.value.success) {
          return okAsync({
            tag: response.tag,
            value: response.value.value,
          });
        }

        return errAsync({
          tag: response.tag,
          value: response.value.value,
        });
      });
    },

    chatPostMessage(payload) {
      const response = fromPromise(transport.request('host_chat_post_message', payload), e => ({
        tag: payload.tag,
        value: new ChatMessagePostingErr.Unknown({ reason: extractErrorMessage(e) }),
      }));

      return response.andThen(response => {
        if (response.value.success) {
          return okAsync({
            tag: response.tag,
            value: response.value.value,
          });
        }

        return errAsync({
          tag: response.tag,
          value: response.value.value,
        });
      });
    },

    chatActionSubscribe(args, callback) {
      return transport.subscribe('host_chat_action_subscribe', args, callback);
    },

    statementStoreQuery(payload) {
      const response = fromPromise(transport.request('remote_statement_store_query', payload), e => ({
        tag: payload.tag,
        value: new GenericError({ reason: extractErrorMessage(e) }),
      }));

      return response.andThen(response => {
        if (response.value.success) {
          return okAsync({
            tag: response.tag,
            value: response.value.value,
          });
        }

        return errAsync({
          tag: response.tag,
          value: response.value.value,
        });
      });
    },

    statementStoreSubscribe(args, callback) {
      return transport.subscribe('remote_statement_store_subscribe', args, callback);
    },

    statementStoreCreateProof(payload) {
      const response = fromPromise(transport.request('remote_statement_store_create_proof', payload), e => ({
        tag: payload.tag,
        value: new StatementProofErr.Unknown({ reason: extractErrorMessage(e) }),
      }));

      return response.andThen(response => {
        if (response.value.success) {
          return okAsync({
            tag: response.tag,
            value: response.value.value,
          });
        }

        return errAsync({
          tag: response.tag,
          value: response.value.value,
        });
      });
    },

    statementStoreSubmit(payload) {
      const response = fromPromise(transport.request('remote_statement_store_submit', payload), e => ({
        tag: payload.tag,
        value: new GenericError({ reason: extractErrorMessage(e) }),
      }));

      return response.andThen(response => {
        if (response.value.success) {
          return okAsync({
            tag: response.tag,
            value: response.value.value,
          });
        }

        return errAsync({
          tag: response.tag,
          value: response.value.value,
        });
      });
    },

    jsonrpcMessageSend(payload) {
      const response = fromPromise(transport.request('host_jsonrpc_message_send', payload), e => ({
        tag: payload.tag,
        value: new GenericError({ reason: extractErrorMessage(e) }),
      }));

      return response.andThen(response => {
        if (response.value.success) {
          return okAsync({
            tag: response.tag,
            value: response.value.value,
          });
        }

        return errAsync({
          tag: response.tag,
          value: response.value.value,
        });
      });
    },

    jsonrpcMessageSubscribe(args, callback) {
      return transport.subscribe('host_jsonrpc_message_subscribe', args, callback);
    },
  };
}
