import type { ResultAsync } from 'neverthrow';
import { errAsync, fromPromise, okAsync } from 'neverthrow';
import type { Codec, CodecType } from 'scale-ts';

import { extractErrorMessage } from './helpers.js';
import { GenericError } from './protocol/commonCodecs.js';
import type { HostApiProtocol, VersionedProtocolRequest, VersionedProtocolSubscription } from './protocol/impl.js';
import { CreateProofErr, GetUserIdErr, LoginErr, RequestCredentialsErr } from './protocol/v1/accounts.js';
import { ChatBotRegistrationErr, ChatMessagePostingErr, ChatRoomRegistrationErr } from './protocol/v1/chat.js';
import { CreateTransactionErr } from './protocol/v1/createTransaction.js';
import { DeriveEntropyErr } from './protocol/v1/deriveEntropy.js';
import { HandshakeErr } from './protocol/v1/handshake.js';
import { StorageErr } from './protocol/v1/localStorage.js';
import { NavigateToErr } from './protocol/v1/navigation.js';
import { PushNotificationError } from './protocol/v1/notification.js';
import { PaymentRequestErr, PaymentTopUpErr } from './protocol/v1/payments.js';
import { PreimageSubmitErr } from './protocol/v1/preimage.js';
import { ResourceAllocationErr } from './protocol/v1/resourceAllocation.js';
import { SigningErr } from './protocol/v1/sign.js';
import { StatementProofErr } from './protocol/v1/statementStore.js';
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
) => Subscription<Value<Method['interrupt']>>;

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
      return makeRequest(transport.request('host_handshake', payload), reason => ({
        tag: payload.tag,
        value: new HandshakeErr.Unknown({ reason }),
      }));
    },

    featureSupported(payload) {
      return makeRequest(transport.request('host_feature_supported', payload), reason => ({
        tag: payload.tag,
        value: new GenericError({ reason }),
      }));
    },

    themeSubscribe(args, callback) {
      return transport.subscribe('host_theme_subscribe', args, callback);
    },

    devicePermission(payload) {
      return makeRequest(transport.request('host_device_permission', payload), reason => ({
        tag: payload.tag,
        value: new GenericError({ reason }),
      }));
    },

    permission(payload) {
      return makeRequest(transport.request('remote_permission', payload), reason => ({
        tag: payload.tag,
        value: new GenericError({ reason }),
      }));
    },

    pushNotification(payload) {
      return makeRequest(transport.request('host_push_notification', payload), reason => ({
        tag: payload.tag,
        value: new PushNotificationError.Unknown({ reason }),
      }));
    },

    pushNotificationCancel(payload) {
      return makeRequest(transport.request('host_push_notification_cancel', payload), reason => ({
        tag: payload.tag,
        value: new GenericError({ reason }),
      }));
    },

    navigateTo(payload) {
      return makeRequest(transport.request('host_navigate_to', payload), reason => ({
        tag: payload.tag,
        value: new NavigateToErr.Unknown({ reason }),
      }));
    },

    deriveEntropy(payload) {
      return makeRequest(transport.request('host_derive_entropy', payload), reason => ({
        tag: payload.tag,
        value: new DeriveEntropyErr.Unknown({ reason }),
      }));
    },

    localStorageRead(payload) {
      return makeRequest(transport.request('host_local_storage_read', payload), reason => ({
        tag: payload.tag,
        value: new StorageErr.Unknown({ reason }),
      }));
    },

    localStorageWrite(payload) {
      return makeRequest(transport.request('host_local_storage_write', payload), reason => ({
        tag: payload.tag,
        value: new StorageErr.Unknown({ reason }),
      }));
    },

    localStorageClear(payload) {
      return makeRequest(transport.request('host_local_storage_clear', payload), reason => ({
        tag: payload.tag,
        value: new StorageErr.Unknown({ reason }),
      }));
    },

    accountConnectionStatusSubscribe(args, callback) {
      return transport.subscribe('host_account_connection_status_subscribe', args, callback);
    },

    getUserId(payload) {
      return makeRequest(transport.request('host_get_user_id', payload), reason => ({
        tag: payload.tag,
        value: new GetUserIdErr.Unknown({ reason }),
      }));
    },

    requestLogin(payload) {
      return makeRequest(transport.request('host_request_login', payload), reason => ({
        tag: payload.tag,
        value: new LoginErr.Unknown({ reason }),
      }));
    },

    accountGet(payload) {
      return makeRequest(transport.request('host_account_get', payload), reason => ({
        tag: payload.tag,
        value: new RequestCredentialsErr.Unknown({ reason }),
      }));
    },

    accountGetAlias(payload) {
      return makeRequest(transport.request('host_account_get_alias', payload), reason => ({
        tag: payload.tag,
        value: new RequestCredentialsErr.Unknown({ reason }),
      }));
    },

    accountCreateProof(payload) {
      return makeRequest(transport.request('host_account_create_proof', payload), reason => ({
        tag: payload.tag,
        value: new CreateProofErr.Unknown({ reason }),
      }));
    },

    getLegacyAccounts(payload) {
      return makeRequest(transport.request('host_get_legacy_accounts', payload), reason => ({
        tag: payload.tag,
        value: new RequestCredentialsErr.Unknown({ reason }),
      }));
    },

    createTransaction(payload) {
      return makeRequest(transport.request('host_create_transaction', payload), reason => ({
        tag: payload.tag,
        value: new CreateTransactionErr.Unknown({ reason }),
      }));
    },

    createTransactionWithLegacyAccount(payload) {
      return makeRequest(transport.request('host_create_transaction_with_legacy_account', payload), reason => ({
        tag: payload.tag,
        value: new CreateTransactionErr.Unknown({ reason }),
      }));
    },

    signRaw(payload) {
      return makeRequest(transport.request('host_sign_raw', payload), reason => ({
        tag: payload.tag,
        value: new SigningErr.Unknown({ reason }),
      }));
    },

    signPayload(payload) {
      return makeRequest(transport.request('host_sign_payload', payload), reason => ({
        tag: payload.tag,
        value: new SigningErr.Unknown({ reason }),
      }));
    },

    signRawWithLegacyAccount(payload) {
      return makeRequest(transport.request('host_sign_raw_with_legacy_account', payload), reason => ({
        tag: payload.tag,
        value: new SigningErr.Unknown({ reason }),
      }));
    },

    signPayloadWithLegacyAccount(payload) {
      return makeRequest(transport.request('host_sign_payload_with_legacy_account', payload), reason => ({
        tag: payload.tag,
        value: new SigningErr.Unknown({ reason }),
      }));
    },

    chatListSubscribe(args, callback) {
      return transport.subscribe('host_chat_list_subscribe', args, callback);
    },

    chatCreateRoom(payload) {
      return makeRequest(transport.request('host_chat_create_room', payload), reason => ({
        tag: payload.tag,
        value: new ChatRoomRegistrationErr.Unknown({ reason }),
      }));
    },

    chatRegisterBot(payload) {
      return makeRequest(transport.request('host_chat_register_bot', payload), reason => ({
        tag: payload.tag,
        value: new ChatBotRegistrationErr.Unknown({ reason }),
      }));
    },

    chatPostMessage(payload) {
      return makeRequest(transport.request('host_chat_post_message', payload), reason => ({
        tag: payload.tag,
        value: new ChatMessagePostingErr.Unknown({ reason }),
      }));
    },

    chatActionSubscribe(args, callback) {
      return transport.subscribe('host_chat_action_subscribe', args, callback);
    },

    productChatCustomMessageRenderSubscribe(args, callback) {
      return transport.subscribe('product_chat_custom_message_render_subscribe', args, callback);
    },

    statementStoreSubscribe(args, callback) {
      return transport.subscribe('remote_statement_store_subscribe', args, callback);
    },

    statementStoreCreateProof(payload) {
      return makeRequest(transport.request('remote_statement_store_create_proof', payload), reason => ({
        tag: payload.tag,
        value: new StatementProofErr.Unknown({ reason }),
      }));
    },

    statementStoreCreateProofAuthorized(payload) {
      return makeRequest(transport.request('remote_statement_store_create_proof_authorized', payload), reason => ({
        tag: payload.tag,
        value: new StatementProofErr.Unknown({ reason }),
      }));
    },

    statementStoreSubmit(payload) {
      return makeRequest(transport.request('remote_statement_store_submit', payload), reason => ({
        tag: payload.tag,
        value: new GenericError({ reason }),
      }));
    },

    preimageLookupSubscribe(args, callback) {
      return transport.subscribe('remote_preimage_lookup_subscribe', args, callback);
    },

    preimageSubmit(payload) {
      return makeRequest(transport.request('remote_preimage_submit', payload), reason => ({
        tag: payload.tag,
        value: new PreimageSubmitErr.Unknown({ reason }),
      }));
    },

    paymentBalanceSubscribe(args, callback) {
      return transport.subscribe('host_payment_balance_subscribe', args, callback);
    },

    paymentTopUp(payload) {
      return makeRequest(transport.request('host_payment_top_up', payload), reason => ({
        tag: payload.tag,
        value: new PaymentTopUpErr.Unknown({ reason }),
      }));
    },

    paymentRequest(payload) {
      return makeRequest(transport.request('host_payment_request', payload), reason => ({
        tag: payload.tag,
        value: new PaymentRequestErr.Unknown({ reason }),
      }));
    },

    paymentStatusSubscribe(args, callback) {
      return transport.subscribe('host_payment_status_subscribe', args, callback);
    },

    requestResourceAllocation(payload) {
      return makeRequest(transport.request('host_request_resource_allocation', payload), reason => ({
        tag: payload.tag,
        value: new ResourceAllocationErr.Unknown({ reason }),
      }));
    },

    // chain interaction

    chainHeadFollowSubscribe(args, callback) {
      return transport.subscribe('remote_chain_head_follow_subscribe', args, callback);
    },

    chainHeadHeader(payload) {
      return makeRequest(transport.request('remote_chain_head_header', payload), reason => ({
        tag: payload.tag,
        value: new GenericError({ reason }),
      }));
    },

    chainHeadBody(payload) {
      return makeRequest(transport.request('remote_chain_head_body', payload), reason => ({
        tag: payload.tag,
        value: new GenericError({ reason }),
      }));
    },

    chainHeadStorage(payload) {
      return makeRequest(transport.request('remote_chain_head_storage', payload), reason => ({
        tag: payload.tag,
        value: new GenericError({ reason }),
      }));
    },

    chainHeadCall(payload) {
      return makeRequest(transport.request('remote_chain_head_call', payload), reason => ({
        tag: payload.tag,
        value: new GenericError({ reason }),
      }));
    },

    chainHeadUnpin(payload) {
      return makeRequest(transport.request('remote_chain_head_unpin', payload), reason => ({
        tag: payload.tag,
        value: new GenericError({ reason }),
      }));
    },

    chainHeadContinue(payload) {
      return makeRequest(transport.request('remote_chain_head_continue', payload), reason => ({
        tag: payload.tag,
        value: new GenericError({ reason }),
      }));
    },

    chainHeadStopOperation(payload) {
      return makeRequest(transport.request('remote_chain_head_stop_operation', payload), reason => ({
        tag: payload.tag,
        value: new GenericError({ reason }),
      }));
    },

    chainSpecGenesisHash(payload) {
      return makeRequest(transport.request('remote_chain_spec_genesis_hash', payload), reason => ({
        tag: payload.tag,
        value: new GenericError({ reason }),
      }));
    },

    chainSpecChainName(payload) {
      return makeRequest(transport.request('remote_chain_spec_chain_name', payload), reason => ({
        tag: payload.tag,
        value: new GenericError({ reason }),
      }));
    },

    chainSpecProperties(payload) {
      return makeRequest(transport.request('remote_chain_spec_properties', payload), reason => ({
        tag: payload.tag,
        value: new GenericError({ reason }),
      }));
    },

    chainTransactionBroadcast(payload) {
      return makeRequest(transport.request('remote_chain_transaction_broadcast', payload), reason => ({
        tag: payload.tag,
        value: new GenericError({ reason }),
      }));
    },

    chainTransactionStop(payload) {
      return makeRequest(transport.request('remote_chain_transaction_stop', payload), reason => ({
        tag: payload.tag,
        value: new GenericError({ reason }),
      }));
    },
  };
}

function makeRequest<Tag extends string, R extends { success: boolean; value: unknown }>(
  promise: Promise<{ tag: Tag; value: R }>,
  mapErr: (e: string) => { tag: Tag; value: Extract<R, { success: false }>['value'] },
): ResultAsync<
  { tag: Tag; value: Extract<R, { success: true }>['value'] },
  { tag: Tag; value: Extract<R, { success: false }>['value'] }
> {
  return fromPromise(promise, e => mapErr(extractErrorMessage(e))).andThen(r => {
    if (r.value.success) return okAsync({ tag: r.tag, value: r.value.value });
    return errAsync({ tag: r.tag, value: r.value.value });
  });
}
