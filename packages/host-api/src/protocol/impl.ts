import type { EnumCodec } from '@novasamatech/scale';
import { Enum } from '@novasamatech/scale';
import type { Codec } from 'scale-ts';

import {
  AccountCreateProofV1_request,
  AccountCreateProofV1_response,
  AccountGetAliasV1_request,
  AccountGetAliasV1_response,
  AccountGetV1_request,
  AccountGetV1_response,
  GetNonProductAccountsV1_request,
  GetNonProductAccountsV1_response,
} from './v1/accounts.js';
import {
  ChatActionSubscribeV1_receive,
  ChatActionSubscribeV1_start,
  ChatCreateRoomV1_request,
  ChatCreateRoomV1_response,
  ChatListSubscribeV1_receive,
  ChatListSubscribeV1_start,
  ChatPostMessageV1_request,
  ChatPostMessageV1_response,
  ChatRegisterBotV1_request,
  ChatRegisterBotV1_response,
} from './v1/chat.js';
import {
  CreateTransactionV1_request,
  CreateTransactionV1_response,
  CreateTransactionWithNonProductAccountV1_request,
  CreateTransactionWithNonProductAccountV1_response,
} from './v1/createTransaction.js';
import { DevicePermissionV1_request, DevicePermissionV1_response } from './v1/devicePermission.js';
import { FeatureV1_request, FeatureV1_response } from './v1/feature.js';
import { HandshakeV1_request, HandshakeV1_response } from './v1/handshake.js';
import {
  JsonRpcMessageSendV1_request,
  JsonRpcMessageSendV1_response,
  JsonRpcMessageSubscribeV1_receive,
  JsonRpcMessageSubscribeV1_start,
} from './v1/jsonRpc.js';
import {
  StorageClearV1_request,
  StorageClearV1_response,
  StorageReadV1_request,
  StorageReadV1_response,
  StorageWriteV1_request,
  StorageWriteV1_response,
} from './v1/localStorage.js';
import { NavigateToV1_request, NavigateToV1_response } from './v1/navigation.js';
import { PushNotificationV1_request, PushNotificationV1_response } from './v1/notification.js';
import {
  PreimageLookupSubscribeV1_receive,
  PreimageLookupSubscribeV1_start,
  PreimageSubmitV1_request,
  PreimageSubmitV1_response,
} from './v1/preimage.js';
import { RemotePermissionV1_request, RemotePermissionV1_response } from './v1/remotePermission.js';
import { SignPayloadV1_request, SignPayloadV1_response, SignRawV1_request, SignRawV1_response } from './v1/sign.js';
import {
  StatementStoreCreateProofV1_request,
  StatementStoreCreateProofV1_response,
  StatementStoreSubmitV1_request,
  StatementStoreSubmitV1_response,
  StatementStoreSubscribeV1_receive,
  StatementStoreSubscribeV1_start,
} from './v1/statementStore.js';

// helpers

export type VersionedArguments = Record<string, [Codec<any>, Codec<any>]>;

type InferVersionedArgument<EnumValues extends VersionedArguments, N extends number> = {
  [V in keyof EnumValues]: EnumValues[V][N];
};

export type VersionedProtocolRequest<T extends VersionedArguments = VersionedArguments> = {
  method: 'request';
  request: EnumCodec<InferVersionedArgument<T, 0>>;
  response: EnumCodec<InferVersionedArgument<T, 1>>;
};

export type VersionedProtocolSubscription<T extends VersionedArguments = VersionedArguments> = {
  method: 'subscribe';
  start: EnumCodec<InferVersionedArgument<T, 0>>;
  receive: EnumCodec<InferVersionedArgument<T, 1>>;
};

const enumFromArg = <const Values extends VersionedArguments, const N extends number>(enumValues: Values, n: N) => {
  return Enum(
    Object.fromEntries(Object.entries(enumValues).map(([key, value]) => [key, value[n]])) as InferVersionedArgument<
      Values,
      N
    >,
  );
};

const versionedRequest = <const EnumValues extends VersionedArguments>(
  values: EnumValues,
): VersionedProtocolRequest<EnumValues> => {
  return {
    method: 'request',
    request: enumFromArg(values, 0),
    response: enumFromArg(values, 1),
  };
};

const versionedSubscription = <const EnumValues extends VersionedArguments>(
  values: EnumValues,
): VersionedProtocolSubscription<EnumValues> => {
  return {
    method: 'subscribe',
    start: enumFromArg(values, 0),
    receive: enumFromArg(values, 1),
  };
};

// actual api

export type HostApiProtocol = typeof hostApiProtocol;

export const hostApiProtocol = {
  // Host calls

  host_handshake: versionedRequest({
    v1: [HandshakeV1_request, HandshakeV1_response],
  }),

  host_feature_supported: versionedRequest({
    v1: [FeatureV1_request, FeatureV1_response],
  }),

  host_push_notification: versionedRequest({
    v1: [PushNotificationV1_request, PushNotificationV1_response],
  }),

  host_navigate_to: versionedRequest({
    v1: [NavigateToV1_request, NavigateToV1_response],
  }),

  // Permissions

  host_device_permission: versionedRequest({
    v1: [DevicePermissionV1_request, DevicePermissionV1_response],
  }),

  remote_permission: versionedRequest({
    v1: [RemotePermissionV1_request, RemotePermissionV1_response],
  }),

  // Local storage

  host_local_storage_read: versionedRequest({
    v1: [StorageReadV1_request, StorageReadV1_response],
  }),

  host_local_storage_write: versionedRequest({
    v1: [StorageWriteV1_request, StorageWriteV1_response],
  }),

  host_local_storage_clear: versionedRequest({
    v1: [StorageClearV1_request, StorageClearV1_response],
  }),

  // Account management

  host_account_get: versionedRequest({
    v1: [AccountGetV1_request, AccountGetV1_response],
  }),

  host_account_get_alias: versionedRequest({
    v1: [AccountGetAliasV1_request, AccountGetAliasV1_response],
  }),

  host_account_create_proof: versionedRequest({
    v1: [AccountCreateProofV1_request, AccountCreateProofV1_response],
  }),

  host_get_non_product_accounts: versionedRequest({
    v1: [GetNonProductAccountsV1_request, GetNonProductAccountsV1_response],
  }),

  // Signing

  host_create_transaction: versionedRequest({
    v1: [CreateTransactionV1_request, CreateTransactionV1_response],
  }),

  host_create_transaction_with_non_product_account: versionedRequest({
    v1: [CreateTransactionWithNonProductAccountV1_request, CreateTransactionWithNonProductAccountV1_response],
  }),

  host_sign_raw: versionedRequest({
    v1: [SignRawV1_request, SignRawV1_response],
  }),

  host_sign_payload: versionedRequest({
    v1: [SignPayloadV1_request, SignPayloadV1_response],
  }),

  // Chat

  host_chat_create_room: versionedRequest({
    v1: [ChatCreateRoomV1_request, ChatCreateRoomV1_response],
  }),

  host_chat_register_bot: versionedRequest({
    v1: [ChatRegisterBotV1_request, ChatRegisterBotV1_response],
  }),

  host_chat_list_subscribe: versionedSubscription({
    v1: [ChatListSubscribeV1_start, ChatListSubscribeV1_receive],
  }),

  host_chat_post_message: versionedRequest({
    v1: [ChatPostMessageV1_request, ChatPostMessageV1_response],
  }),

  host_chat_action_subscribe: versionedSubscription({
    v1: [ChatActionSubscribeV1_start, ChatActionSubscribeV1_receive],
  }),

  // Statement store (remote namespace)

  remote_statement_store_subscribe: versionedSubscription({
    v1: [StatementStoreSubscribeV1_start, StatementStoreSubscribeV1_receive],
  }),

  remote_statement_store_create_proof: versionedRequest({
    v1: [StatementStoreCreateProofV1_request, StatementStoreCreateProofV1_response],
  }),

  remote_statement_store_submit: versionedRequest({
    v1: [StatementStoreSubmitV1_request, StatementStoreSubmitV1_response],
  }),

  // Preimage lookup

  remote_preimage_lookup_subscribe: versionedSubscription({
    v1: [PreimageLookupSubscribeV1_start, PreimageLookupSubscribeV1_receive],
  }),

  remote_preimage_submit: versionedRequest({
    v1: [PreimageSubmitV1_request, PreimageSubmitV1_response],
  }),

  // json rpc (temporary, kept until chain methods are added)

  host_jsonrpc_message_send: versionedRequest({
    v1: [JsonRpcMessageSendV1_request, JsonRpcMessageSendV1_response],
  }),

  host_jsonrpc_message_subscribe: versionedSubscription({
    v1: [JsonRpcMessageSubscribeV1_start, JsonRpcMessageSubscribeV1_receive],
  }),
} as const;
