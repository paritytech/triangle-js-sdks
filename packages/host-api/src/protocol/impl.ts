import type { EnumCodec } from '@novasamatech/scale';
import { Enum } from '@novasamatech/scale';
import type { Codec } from 'scale-ts';
import { Result, _void } from 'scale-ts';

import {
  AccountConnectionStatusV1_interrupt,
  AccountConnectionStatusV1_receive,
  AccountConnectionStatusV1_start,
  AccountCreateProofV1_request,
  AccountCreateProofV1_response,
  AccountGetAliasV1_request,
  AccountGetAliasV1_response,
  AccountGetV1_request,
  AccountGetV1_response,
  GetLegacyAccountsV1_request,
  GetLegacyAccountsV1_response,
  GetUserIdV1_request,
  GetUserIdV1_response,
  RequestLoginV1_request,
  RequestLoginV1_response,
} from './v1/accounts.js';
import {
  ChainHeadBodyV1_request,
  ChainHeadBodyV1_response,
  ChainHeadCallV1_request,
  ChainHeadCallV1_response,
  ChainHeadContinueV1_request,
  ChainHeadContinueV1_response,
  ChainHeadFollowV1_interrupt,
  ChainHeadFollowV1_receive,
  ChainHeadFollowV1_start,
  ChainHeadHeaderV1_request,
  ChainHeadHeaderV1_response,
  ChainHeadStopOperationV1_request,
  ChainHeadStopOperationV1_response,
  ChainHeadStorageV1_request,
  ChainHeadStorageV1_response,
  ChainHeadUnpinV1_request,
  ChainHeadUnpinV1_response,
  ChainSpecChainNameV1_request,
  ChainSpecChainNameV1_response,
  ChainSpecGenesisHashV1_request,
  ChainSpecGenesisHashV1_response,
  ChainSpecPropertiesV1_request,
  ChainSpecPropertiesV1_response,
  TransactionBroadcastV1_request,
  TransactionBroadcastV1_response,
  TransactionStopV1_request,
  TransactionStopV1_response,
} from './v1/chainInteraction.js';
import {
  ChatActionSubscribeV1_interrupt,
  ChatActionSubscribeV1_receive,
  ChatActionSubscribeV1_start,
  ChatCreateRoomV1_request,
  ChatCreateRoomV1_response,
  ChatCustomMessageRenderingV1_interrupt,
  ChatCustomMessageRenderingV1_receive,
  ChatCustomMessageRenderingV1_start,
  ChatListSubscribeV1_interrupt,
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
  CreateTransactionWithLegacyAccountV1_request,
  CreateTransactionWithLegacyAccountV1_response,
} from './v1/createTransaction.js';
import { DeriveEntropyV1_request, DeriveEntropyV1_response } from './v1/deriveEntropy.js';
import { DevicePermissionV1_request, DevicePermissionV1_response } from './v1/devicePermission.js';
import { FeatureV1_request, FeatureV1_response } from './v1/feature.js';
import { HandshakeV1_request, HandshakeV1_response } from './v1/handshake.js';
import {
  StorageClearV1_request,
  StorageClearV1_response,
  StorageReadV1_request,
  StorageReadV1_response,
  StorageWriteV1_request,
  StorageWriteV1_response,
} from './v1/localStorage.js';
import { NavigateToV1_request, NavigateToV1_response } from './v1/navigation.js';
import {
  PushNotificationCancelV1_request,
  PushNotificationCancelV1_response,
  PushNotificationV1_request,
  PushNotificationV1_response,
} from './v1/notification.js';
import {
  PaymentBalanceSubscribeV1_interrupt,
  PaymentBalanceSubscribeV1_receive,
  PaymentBalanceSubscribeV1_start,
  PaymentRequestV1_request,
  PaymentRequestV1_response,
  PaymentStatusSubscribeV1_interrupt,
  PaymentStatusSubscribeV1_receive,
  PaymentStatusSubscribeV1_start,
  PaymentTopUpV1_request,
  PaymentTopUpV1_response,
} from './v1/payments.js';
import {
  PreimageLookupSubscribeV1_interrupt,
  PreimageLookupSubscribeV1_receive,
  PreimageLookupSubscribeV1_start,
  PreimageSubmitV1_request,
  PreimageSubmitV1_response,
} from './v1/preimage.js';
import {
  PushAddRulesV1_request,
  PushAddRulesV1_response,
  PushBroadcastV1_request,
  PushBroadcastV1_response,
  PushListRulesV1_request,
  PushListRulesV1_response,
  PushRemoveRulesV1_request,
  PushRemoveRulesV1_response,
  PushSetRulesV1_request,
  PushSetRulesV1_response,
} from './v1/pushSubscription.js';
import { RemotePermissionV1_request, RemotePermissionV1_response } from './v1/remotePermission.js';
import { RequestResourceAllocationV1_request, RequestResourceAllocationV1_response } from './v1/resourceAllocation.js';
import {
  SignPayloadV1_request,
  SignPayloadV1_response,
  SignPayloadWithLegacyAccountV1_request,
  SignPayloadWithLegacyAccountV1_response,
  SignRawV1_request,
  SignRawV1_response,
  SignRawWithLegacyAccountV1_request,
  SignRawWithLegacyAccountV1_response,
} from './v1/sign.js';
import {
  StatementStoreCreateProofAuthorizedV1_request,
  StatementStoreCreateProofAuthorizedV1_response,
  StatementStoreCreateProofV1_request,
  StatementStoreCreateProofV1_response,
  StatementStoreSubmitV1_request,
  StatementStoreSubmitV1_response,
  StatementStoreSubscribeV1_interrupt,
  StatementStoreSubscribeV1_receive,
  StatementStoreSubscribeV1_start,
} from './v1/statementStore.js';
import { ThemeSubscribeV1_interrupt, ThemeSubscribeV1_receive, ThemeSubscribeV1_start } from './v1/theme.js';

// helpers

export type VersionedRequestArguments = Record<string, [Codec<any>, Codec<any>]>;
export type VersionedSubscriptionArguments = Record<string, [Codec<any>, Codec<any>, Codec<any>]>;

export type VersionedArguments = VersionedRequestArguments;

type InferVersionedArgument<EnumValues extends Record<string, Codec<any>[]>, N extends number> = {
  [V in keyof EnumValues]: EnumValues[V][N];
};

export type VersionedProtocolRequest<T extends VersionedRequestArguments = VersionedRequestArguments> = {
  method: 'request';
  request: EnumCodec<InferVersionedArgument<T, 0>>;
  response: EnumCodec<InferVersionedArgument<T, 1>>;
};

export type VersionedProtocolSubscription<T extends VersionedSubscriptionArguments = VersionedSubscriptionArguments> = {
  method: 'subscribe';
  start: EnumCodec<InferVersionedArgument<T, 0>>;
  receive: EnumCodec<InferVersionedArgument<T, 1>>;
  interrupt: EnumCodec<InferVersionedArgument<T, 2>>;
};

const enumFromArg = <const Values extends Record<string, Codec<any>[]>, const N extends number>(
  enumValues: Values,
  n: N,
) => {
  return Enum(
    Object.fromEntries(Object.entries(enumValues).map(([key, value]) => [key, value[n]])) as InferVersionedArgument<
      Values,
      N
    >,
  );
};

const versionedRequest = <const EnumValues extends VersionedRequestArguments>(
  values: EnumValues,
): VersionedProtocolRequest<EnumValues> => {
  return {
    method: 'request',
    request: enumFromArg(values, 0),
    response: enumFromArg(values, 1),
  };
};

const versionedSubscription = <const EnumValues extends VersionedSubscriptionArguments>(
  values: EnumValues,
): VersionedProtocolSubscription<EnumValues> => {
  return {
    method: 'subscribe',
    start: enumFromArg(values, 0),
    receive: enumFromArg(values, 1),
    interrupt: enumFromArg(values, 2),
  };
};

// actual api

export type HostApiProtocol = typeof hostApiProtocol;

export const hostApiProtocol = {
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

  host_device_permission: versionedRequest({
    v1: [DevicePermissionV1_request, DevicePermissionV1_response],
  }),

  remote_permission: versionedRequest({
    v1: [RemotePermissionV1_request, RemotePermissionV1_response],
  }),

  host_local_storage_read: versionedRequest({
    v1: [StorageReadV1_request, StorageReadV1_response],
  }),

  host_local_storage_write: versionedRequest({
    v1: [StorageWriteV1_request, StorageWriteV1_response],
  }),

  host_local_storage_clear: versionedRequest({
    v1: [StorageClearV1_request, StorageClearV1_response],
  }),

  host_account_connection_status_subscribe: versionedSubscription({
    v1: [AccountConnectionStatusV1_start, AccountConnectionStatusV1_receive, AccountConnectionStatusV1_interrupt],
  }),

  host_account_get: versionedRequest({
    v1: [AccountGetV1_request, AccountGetV1_response],
  }),

  host_account_get_alias: versionedRequest({
    v1: [AccountGetAliasV1_request, AccountGetAliasV1_response],
  }),

  host_account_create_proof: versionedRequest({
    v1: [AccountCreateProofV1_request, AccountCreateProofV1_response],
  }),

  host_get_legacy_accounts: versionedRequest({
    v1: [GetLegacyAccountsV1_request, GetLegacyAccountsV1_response],
  }),

  host_create_transaction: versionedRequest({
    v1: [CreateTransactionV1_request, CreateTransactionV1_response],
  }),

  host_create_transaction_with_legacy_account: versionedRequest({
    v1: [CreateTransactionWithLegacyAccountV1_request, CreateTransactionWithLegacyAccountV1_response],
  }),

  host_sign_raw_with_legacy_account: versionedRequest({
    v1: [SignRawWithLegacyAccountV1_request, SignRawWithLegacyAccountV1_response],
  }),

  host_sign_payload_with_legacy_account: versionedRequest({
    v1: [SignPayloadWithLegacyAccountV1_request, SignPayloadWithLegacyAccountV1_response],
  }),

  host_chat_create_room: versionedRequest({
    v1: [ChatCreateRoomV1_request, ChatCreateRoomV1_response],
  }),

  host_chat_register_bot: versionedRequest({
    v1: [ChatRegisterBotV1_request, ChatRegisterBotV1_response],
  }),

  host_chat_list_subscribe: versionedSubscription({
    v1: [ChatListSubscribeV1_start, ChatListSubscribeV1_receive, ChatListSubscribeV1_interrupt],
  }),

  host_chat_post_message: versionedRequest({
    v1: [ChatPostMessageV1_request, ChatPostMessageV1_response],
  }),

  host_chat_action_subscribe: versionedSubscription({
    v1: [ChatActionSubscribeV1_start, ChatActionSubscribeV1_receive, ChatActionSubscribeV1_interrupt],
  }),

  product_chat_custom_message_render_subscribe: versionedSubscription({
    v1: [
      ChatCustomMessageRenderingV1_start,
      ChatCustomMessageRenderingV1_receive,
      ChatCustomMessageRenderingV1_interrupt,
    ],
  }),

  remote_statement_store_subscribe: versionedSubscription({
    v1: [StatementStoreSubscribeV1_start, StatementStoreSubscribeV1_receive, StatementStoreSubscribeV1_interrupt],
  }),

  remote_statement_store_create_proof: versionedRequest({
    v1: [StatementStoreCreateProofV1_request, StatementStoreCreateProofV1_response],
  }),

  remote_statement_store_submit: versionedRequest({
    v1: [StatementStoreSubmitV1_request, StatementStoreSubmitV1_response],
  }),

  remote_preimage_lookup_subscribe: versionedSubscription({
    v1: [PreimageLookupSubscribeV1_start, PreimageLookupSubscribeV1_receive, PreimageLookupSubscribeV1_interrupt],
  }),

  remote_preimage_submit: versionedRequest({
    v1: [PreimageSubmitV1_request, PreimageSubmitV1_response],
  }),

  // json rpc (deprecated: use remote_chain_* methods instead)
  host_jsonrpc_message_send: versionedRequest({
    v1: [_void, Result(_void, _void)],
  }),

  // json rpc (deprecated: use remote_chain_* methods instead)
  host_jsonrpc_message_subscribe: versionedSubscription({
    v1: [_void, _void, _void],
  }),

  remote_chain_head_follow_subscribe: versionedSubscription({
    v1: [ChainHeadFollowV1_start, ChainHeadFollowV1_receive, ChainHeadFollowV1_interrupt],
  }),

  remote_chain_head_header: versionedRequest({
    v1: [ChainHeadHeaderV1_request, ChainHeadHeaderV1_response],
  }),

  remote_chain_head_body: versionedRequest({
    v1: [ChainHeadBodyV1_request, ChainHeadBodyV1_response],
  }),

  remote_chain_head_storage: versionedRequest({
    v1: [ChainHeadStorageV1_request, ChainHeadStorageV1_response],
  }),

  remote_chain_head_call: versionedRequest({
    v1: [ChainHeadCallV1_request, ChainHeadCallV1_response],
  }),

  remote_chain_head_unpin: versionedRequest({
    v1: [ChainHeadUnpinV1_request, ChainHeadUnpinV1_response],
  }),

  remote_chain_head_continue: versionedRequest({
    v1: [ChainHeadContinueV1_request, ChainHeadContinueV1_response],
  }),

  remote_chain_head_stop_operation: versionedRequest({
    v1: [ChainHeadStopOperationV1_request, ChainHeadStopOperationV1_response],
  }),

  remote_chain_spec_genesis_hash: versionedRequest({
    v1: [ChainSpecGenesisHashV1_request, ChainSpecGenesisHashV1_response],
  }),

  remote_chain_spec_chain_name: versionedRequest({
    v1: [ChainSpecChainNameV1_request, ChainSpecChainNameV1_response],
  }),

  remote_chain_spec_properties: versionedRequest({
    v1: [ChainSpecPropertiesV1_request, ChainSpecPropertiesV1_response],
  }),

  remote_chain_transaction_broadcast: versionedRequest({
    v1: [TransactionBroadcastV1_request, TransactionBroadcastV1_response],
  }),

  remote_chain_transaction_stop: versionedRequest({
    v1: [TransactionStopV1_request, TransactionStopV1_response],
  }),

  host_theme_subscribe: versionedSubscription({
    v1: [ThemeSubscribeV1_start, ThemeSubscribeV1_receive, ThemeSubscribeV1_interrupt],
  }),

  host_derive_entropy: versionedRequest({
    v1: [DeriveEntropyV1_request, DeriveEntropyV1_response],
  }),

  host_get_user_id: versionedRequest({
    v1: [GetUserIdV1_request, GetUserIdV1_response],
  }),

  host_request_login: versionedRequest({
    v1: [RequestLoginV1_request, RequestLoginV1_response],
  }),

  host_sign_raw: versionedRequest({
    v1: [SignRawV1_request, SignRawV1_response],
  }),

  host_sign_payload: versionedRequest({
    v1: [SignPayloadV1_request, SignPayloadV1_response],
  }),

  host_payment_balance_subscribe: versionedSubscription({
    v1: [PaymentBalanceSubscribeV1_start, PaymentBalanceSubscribeV1_receive, PaymentBalanceSubscribeV1_interrupt],
  }),

  host_payment_top_up: versionedRequest({
    v1: [PaymentTopUpV1_request, PaymentTopUpV1_response],
  }),

  host_payment_request: versionedRequest({
    v1: [PaymentRequestV1_request, PaymentRequestV1_response],
  }),

  host_payment_status_subscribe: versionedSubscription({
    v1: [PaymentStatusSubscribeV1_start, PaymentStatusSubscribeV1_receive, PaymentStatusSubscribeV1_interrupt],
  }),

  host_request_resource_allocation: versionedRequest({
    v1: [RequestResourceAllocationV1_request, RequestResourceAllocationV1_response],
  }),

  remote_statement_store_create_proof_authorized: versionedRequest({
    v1: [StatementStoreCreateProofAuthorizedV1_request, StatementStoreCreateProofAuthorizedV1_response],
  }),

  host_push_notification_cancel: versionedRequest({
    v1: [PushNotificationCancelV1_request, PushNotificationCancelV1_response],
  }),

  host_push_add_rules: versionedRequest({
    v1: [PushAddRulesV1_request, PushAddRulesV1_response],
  }),

  host_push_remove_rules: versionedRequest({
    v1: [PushRemoveRulesV1_request, PushRemoveRulesV1_response],
  }),

  host_push_list_rules: versionedRequest({
    v1: [PushListRulesV1_request, PushListRulesV1_response],
  }),

  host_push_set_rules: versionedRequest({
    v1: [PushSetRulesV1_request, PushSetRulesV1_response],
  }),

  host_push_broadcast: versionedRequest({
    v1: [PushBroadcastV1_request, PushBroadcastV1_response],
  }),
} as const;
