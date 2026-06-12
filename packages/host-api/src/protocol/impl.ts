import type { EnumCodec } from '@novasamatech/scale';
import { Enum } from '@novasamatech/scale';
import type { Codec } from 'scale-ts';

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
  /** Base serialization index; `request` takes it, `response` takes `index + 1`. */
  index: number;
  request: EnumCodec<InferVersionedArgument<T, 0>>;
  response: EnumCodec<InferVersionedArgument<T, 1>>;
};

export type VersionedProtocolSubscription<T extends VersionedSubscriptionArguments = VersionedSubscriptionArguments> = {
  method: 'subscribe';
  /** Base serialization index; `start`/`stop`/`interrupt`/`receive` take `index + 0..3`. */
  index: number;
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
  index: number,
  values: EnumValues,
): VersionedProtocolRequest<EnumValues> => {
  return {
    method: 'request',
    index,
    request: enumFromArg(values, 0),
    response: enumFromArg(values, 1),
  };
};

const versionedSubscription = <const EnumValues extends VersionedSubscriptionArguments>(
  index: number,
  values: EnumValues,
): VersionedProtocolSubscription<EnumValues> => {
  return {
    method: 'subscribe',
    index,
    start: enumFromArg(values, 0),
    receive: enumFromArg(values, 1),
    interrupt: enumFromArg(values, 2),
  };
};

// Hands out contiguous serialization indices. Each call reserves the action's
// own slots (request = 2, subscription = 4) and returns its base index, so the
// ABI is self-contained: a method's index depends only on what precedes it.
function createIndexer() {
  let offset = 0;
  const take = (width: number, prefix = 0) => {
    const index = offset;
    offset += prefix + width;

    return prefix + index;
  };

  return {
    request: (prefix?: number) => take(2, prefix),
    subscription: (prefix?: number) => take(4, prefix),
  };
}

// actual api

export type HostApiProtocol = typeof hostApiProtocol;

const indexer = createIndexer();
export const hostApiProtocol = {
  host_handshake: versionedRequest(indexer.request(), {
    v1: [HandshakeV1_request, HandshakeV1_response],
  }),

  host_feature_supported: versionedRequest(indexer.request(), {
    v1: [FeatureV1_request, FeatureV1_response],
  }),

  host_push_notification: versionedRequest(indexer.request(), {
    v1: [PushNotificationV1_request, PushNotificationV1_response],
  }),

  host_navigate_to: versionedRequest(indexer.request(), {
    v1: [NavigateToV1_request, NavigateToV1_response],
  }),

  host_device_permission: versionedRequest(indexer.request(), {
    v1: [DevicePermissionV1_request, DevicePermissionV1_response],
  }),

  remote_permission: versionedRequest(indexer.request(), {
    v1: [RemotePermissionV1_request, RemotePermissionV1_response],
  }),

  host_local_storage_read: versionedRequest(indexer.request(), {
    v1: [StorageReadV1_request, StorageReadV1_response],
  }),

  host_local_storage_write: versionedRequest(indexer.request(), {
    v1: [StorageWriteV1_request, StorageWriteV1_response],
  }),

  host_local_storage_clear: versionedRequest(indexer.request(), {
    v1: [StorageClearV1_request, StorageClearV1_response],
  }),

  host_account_connection_status_subscribe: versionedSubscription(indexer.subscription(), {
    v1: [AccountConnectionStatusV1_start, AccountConnectionStatusV1_receive, AccountConnectionStatusV1_interrupt],
  }),

  host_account_get: versionedRequest(indexer.request(), {
    v1: [AccountGetV1_request, AccountGetV1_response],
  }),

  host_account_get_alias: versionedRequest(indexer.request(), {
    v1: [AccountGetAliasV1_request, AccountGetAliasV1_response],
  }),

  host_account_create_proof: versionedRequest(indexer.request(), {
    v1: [AccountCreateProofV1_request, AccountCreateProofV1_response],
  }),

  host_get_legacy_accounts: versionedRequest(indexer.request(), {
    v1: [GetLegacyAccountsV1_request, GetLegacyAccountsV1_response],
  }),

  host_create_transaction: versionedRequest(indexer.request(), {
    v1: [CreateTransactionV1_request, CreateTransactionV1_response],
  }),

  host_create_transaction_with_legacy_account: versionedRequest(indexer.request(), {
    v1: [CreateTransactionWithLegacyAccountV1_request, CreateTransactionWithLegacyAccountV1_response],
  }),

  host_sign_raw_with_legacy_account: versionedRequest(indexer.request(), {
    v1: [SignRawWithLegacyAccountV1_request, SignRawWithLegacyAccountV1_response],
  }),

  host_sign_payload_with_legacy_account: versionedRequest(indexer.request(), {
    v1: [SignPayloadWithLegacyAccountV1_request, SignPayloadWithLegacyAccountV1_response],
  }),

  host_chat_create_room: versionedRequest(indexer.request(), {
    v1: [ChatCreateRoomV1_request, ChatCreateRoomV1_response],
  }),

  host_chat_register_bot: versionedRequest(indexer.request(), {
    v1: [ChatRegisterBotV1_request, ChatRegisterBotV1_response],
  }),

  host_chat_list_subscribe: versionedSubscription(indexer.subscription(), {
    v1: [ChatListSubscribeV1_start, ChatListSubscribeV1_receive, ChatListSubscribeV1_interrupt],
  }),

  host_chat_post_message: versionedRequest(indexer.request(), {
    v1: [ChatPostMessageV1_request, ChatPostMessageV1_response],
  }),

  host_chat_action_subscribe: versionedSubscription(indexer.subscription(), {
    v1: [ChatActionSubscribeV1_start, ChatActionSubscribeV1_receive, ChatActionSubscribeV1_interrupt],
  }),

  product_chat_custom_message_render_subscribe: versionedSubscription(indexer.subscription(), {
    v1: [
      ChatCustomMessageRenderingV1_start,
      ChatCustomMessageRenderingV1_receive,
      ChatCustomMessageRenderingV1_interrupt,
    ],
  }),

  remote_statement_store_subscribe: versionedSubscription(indexer.subscription(), {
    v1: [StatementStoreSubscribeV1_start, StatementStoreSubscribeV1_receive, StatementStoreSubscribeV1_interrupt],
  }),

  remote_statement_store_create_proof: versionedRequest(indexer.request(), {
    v1: [StatementStoreCreateProofV1_request, StatementStoreCreateProofV1_response],
  }),

  remote_statement_store_submit: versionedRequest(indexer.request(), {
    v1: [StatementStoreSubmitV1_request, StatementStoreSubmitV1_response],
  }),

  remote_preimage_lookup_subscribe: versionedSubscription(indexer.subscription(), {
    v1: [PreimageLookupSubscribeV1_start, PreimageLookupSubscribeV1_receive, PreimageLookupSubscribeV1_interrupt],
  }),

  remote_preimage_submit: versionedRequest(indexer.request(), {
    v1: [PreimageSubmitV1_request, PreimageSubmitV1_response],
  }),

  remote_chain_head_follow_subscribe: versionedSubscription(indexer.subscription(6), {
    v1: [ChainHeadFollowV1_start, ChainHeadFollowV1_receive, ChainHeadFollowV1_interrupt],
  }),

  remote_chain_head_header: versionedRequest(indexer.request(), {
    v1: [ChainHeadHeaderV1_request, ChainHeadHeaderV1_response],
  }),

  remote_chain_head_body: versionedRequest(indexer.request(), {
    v1: [ChainHeadBodyV1_request, ChainHeadBodyV1_response],
  }),

  remote_chain_head_storage: versionedRequest(indexer.request(), {
    v1: [ChainHeadStorageV1_request, ChainHeadStorageV1_response],
  }),

  remote_chain_head_call: versionedRequest(indexer.request(), {
    v1: [ChainHeadCallV1_request, ChainHeadCallV1_response],
  }),

  remote_chain_head_unpin: versionedRequest(indexer.request(), {
    v1: [ChainHeadUnpinV1_request, ChainHeadUnpinV1_response],
  }),

  remote_chain_head_continue: versionedRequest(indexer.request(), {
    v1: [ChainHeadContinueV1_request, ChainHeadContinueV1_response],
  }),

  remote_chain_head_stop_operation: versionedRequest(indexer.request(), {
    v1: [ChainHeadStopOperationV1_request, ChainHeadStopOperationV1_response],
  }),

  remote_chain_spec_genesis_hash: versionedRequest(indexer.request(), {
    v1: [ChainSpecGenesisHashV1_request, ChainSpecGenesisHashV1_response],
  }),

  remote_chain_spec_chain_name: versionedRequest(indexer.request(), {
    v1: [ChainSpecChainNameV1_request, ChainSpecChainNameV1_response],
  }),

  remote_chain_spec_properties: versionedRequest(indexer.request(), {
    v1: [ChainSpecPropertiesV1_request, ChainSpecPropertiesV1_response],
  }),

  remote_chain_transaction_broadcast: versionedRequest(indexer.request(), {
    v1: [TransactionBroadcastV1_request, TransactionBroadcastV1_response],
  }),

  remote_chain_transaction_stop: versionedRequest(indexer.request(), {
    v1: [TransactionStopV1_request, TransactionStopV1_response],
  }),

  host_theme_subscribe: versionedSubscription(indexer.subscription(), {
    v1: [ThemeSubscribeV1_start, ThemeSubscribeV1_receive, ThemeSubscribeV1_interrupt],
  }),

  host_derive_entropy: versionedRequest(indexer.request(), {
    v1: [DeriveEntropyV1_request, DeriveEntropyV1_response],
  }),

  host_get_user_id: versionedRequest(indexer.request(), {
    v1: [GetUserIdV1_request, GetUserIdV1_response],
  }),

  host_request_login: versionedRequest(indexer.request(), {
    v1: [RequestLoginV1_request, RequestLoginV1_response],
  }),

  host_sign_raw: versionedRequest(indexer.request(), {
    v1: [SignRawV1_request, SignRawV1_response],
  }),

  host_sign_payload: versionedRequest(indexer.request(), {
    v1: [SignPayloadV1_request, SignPayloadV1_response],
  }),

  host_payment_balance_subscribe: versionedSubscription(indexer.subscription(), {
    v1: [PaymentBalanceSubscribeV1_start, PaymentBalanceSubscribeV1_receive, PaymentBalanceSubscribeV1_interrupt],
  }),

  host_payment_top_up: versionedRequest(indexer.request(), {
    v1: [PaymentTopUpV1_request, PaymentTopUpV1_response],
  }),

  host_payment_request: versionedRequest(indexer.request(), {
    v1: [PaymentRequestV1_request, PaymentRequestV1_response],
  }),

  host_payment_status_subscribe: versionedSubscription(indexer.subscription(), {
    v1: [PaymentStatusSubscribeV1_start, PaymentStatusSubscribeV1_receive, PaymentStatusSubscribeV1_interrupt],
  }),

  host_request_resource_allocation: versionedRequest(indexer.request(), {
    v1: [RequestResourceAllocationV1_request, RequestResourceAllocationV1_response],
  }),

  remote_statement_store_create_proof_authorized: versionedRequest(indexer.request(), {
    v1: [StatementStoreCreateProofAuthorizedV1_request, StatementStoreCreateProofAuthorizedV1_response],
  }),

  host_push_notification_cancel: versionedRequest(indexer.request(), {
    v1: [PushNotificationCancelV1_request, PushNotificationCancelV1_response],
  }),
} as const;
