import type {
  Codec,
  CodecType,
  ConnectionStatus,
  HexString,
  HostApiProtocol,
  Subscription,
  VersionedProtocolRequest,
  VersionedProtocolSubscription,
} from '@novasamatech/host-api';
import { CustomRendererNode } from '@novasamatech/host-api';
import type { ResultAsync, errAsync } from 'neverthrow';
import { okAsync } from 'neverthrow';
import type { JsonRpcProvider } from 'polkadot-api';

type SuccessResponse<T> = T extends { success: true; value: infer U } ? U : never;
type ErrorResponse<T> = T extends { success: false; value: infer U } ? U : never;

export type CodecValue<T extends Codec<any> | Codec<never>> = T extends Codec<any> ? CodecType<T> : unknown;
type OrPromise<T> = T | Promise<T>;
type ExtractEnumValue<T> = T extends { tag: string; value: infer V } ? V : never;

export type WithVersion<V extends string, T> = ExtractEnumValue<Extract<T, { tag: V }>>;

export type UnwrapSuccessResponse<V extends string, T> = T extends { tag: infer Tag; value: infer Value }
  ? WithVersion<V, { tag: Tag; value: SuccessResponse<Value> }>
  : never;

export type UnwrapErrorResponse<V extends string, T> = T extends { tag: infer Tag; value: infer Value }
  ? WithVersion<V, { tag: Tag; value: ErrorResponse<Value> }>
  : never;

type UnwrapVersionedResult<V extends string, T> = T extends { tag: infer Tag; value: infer Value }
  ? ResultAsync<
      WithVersion<V, { tag: Tag; value: SuccessResponse<Value> }>,
      WithVersion<V, { tag: Tag; value: ErrorResponse<Value> }>
    >
  : never;

export type ContainerRequestHandler<V extends string, T extends VersionedProtocolRequest> = (
  params: WithVersion<V, CodecValue<T['request']>>,
  helpers: {
    ok: typeof okAsync<UnwrapSuccessResponse<V, CodecValue<T['response']>>>;
    err: typeof errAsync<never, UnwrapErrorResponse<V, CodecValue<T['response']>>>;
  },
) => OrPromise<UnwrapVersionedResult<V, CodecValue<T['response']>>>;

type InferRequestHandler<V extends string, T extends VersionedProtocolRequest> = (
  callback: ContainerRequestHandler<V, T>,
) => VoidFunction;

type InferSubscribeHandler<V extends string, T extends VersionedProtocolSubscription> = (
  callback: (
    params: WithVersion<V, CodecValue<T['start']>>,
    send: (payload: WithVersion<V, CodecValue<T['receive']>>) => void,
    interrupt: VoidFunction,
  ) => VoidFunction,
) => VoidFunction;

type InferHandler<
  V extends string,
  T extends VersionedProtocolRequest | VersionedProtocolSubscription,
> = T extends VersionedProtocolRequest
  ? InferRequestHandler<V, T>
  : T extends VersionedProtocolSubscription
    ? InferSubscribeHandler<V, T>
    : never;

export type Container = {
  // host

  handleFeatureSupported: InferHandler<'v1', HostApiProtocol['host_feature_supported']>;
  handleDevicePermission: InferHandler<'v1', HostApiProtocol['host_device_permission']>;
  handlePermission: InferHandler<'v1', HostApiProtocol['remote_permission']>;
  handlePushNotification: InferHandler<'v1', HostApiProtocol['host_push_notification']>;
  handleNavigateTo: InferHandler<'v1', HostApiProtocol['host_navigate_to']>;

  // entropy derivation

  handleDeriveEntropy: InferHandler<'v1', HostApiProtocol['host_derive_entropy']>;

  // storage

  handleLocalStorageRead: InferHandler<'v1', HostApiProtocol['host_local_storage_read']>;
  handleLocalStorageWrite: InferHandler<'v1', HostApiProtocol['host_local_storage_write']>;
  handleLocalStorageClear: InferHandler<'v1', HostApiProtocol['host_local_storage_clear']>;

  // accounts

  handleAccountConnectionStatusSubscribe: InferHandler<
    'v1',
    HostApiProtocol['host_account_connection_status_subscribe']
  >;
  handleThemeSubscribe: InferHandler<'v1', HostApiProtocol['host_theme_subscribe']>;
  handleAccountGet: InferHandler<'v1', HostApiProtocol['host_account_get']>;
  handleAccountGetAlias: InferHandler<'v1', HostApiProtocol['host_account_get_alias']>;
  handleAccountCreateProof: InferHandler<'v1', HostApiProtocol['host_account_create_proof']>;
  handleGetNonProductAccounts: InferHandler<'v1', HostApiProtocol['host_get_non_product_accounts']>;

  // signing

  handleCreateTransaction: InferHandler<'v1', HostApiProtocol['host_create_transaction']>;
  handleCreateTransactionWithNonProductAccount: InferHandler<
    'v1',
    HostApiProtocol['host_create_transaction_with_non_product_account']
  >;
  handleSignRaw: InferHandler<'v1', HostApiProtocol['host_sign_raw']>;
  handleSignPayload: InferHandler<'v1', HostApiProtocol['host_sign_payload']>;
  handleSignRawWithNonProductAccount: InferHandler<'v1', HostApiProtocol['host_sign_raw_with_non_product_account']>;
  handleSignPayloadWithNonProductAccount: InferHandler<
    'v1',
    HostApiProtocol['host_sign_payload_with_non_product_account']
  >;

  // chat

  handleChatCreateRoom: InferHandler<'v1', HostApiProtocol['host_chat_create_room']>;
  handleChatBotRegistration: InferHandler<'v1', HostApiProtocol['host_chat_register_bot']>;
  handleChatListSubscribe: InferHandler<'v1', HostApiProtocol['host_chat_list_subscribe']>;
  handleChatPostMessage: InferHandler<'v1', HostApiProtocol['host_chat_post_message']>;
  handleChatActionSubscribe: InferHandler<'v1', HostApiProtocol['host_chat_action_subscribe']>;

  renderChatCustomMessage(
    params: { messageId: string; messageType: string; payload: Uint8Array },
    callback: (node: CodecType<typeof CustomRendererNode>) => void,
  ): Subscription;

  // statement store

  handleStatementStoreSubscribe: InferHandler<'v1', HostApiProtocol['remote_statement_store_subscribe']>;
  handleStatementStoreCreateProof: InferHandler<'v1', HostApiProtocol['remote_statement_store_create_proof']>;
  handleStatementStoreSubmit: InferHandler<'v1', HostApiProtocol['remote_statement_store_submit']>;

  // preimage

  handlePreimageLookupSubscribe: InferHandler<'v1', HostApiProtocol['remote_preimage_lookup_subscribe']>;
  handlePreimageSubmit: InferHandler<'v1', HostApiProtocol['remote_preimage_submit']>;

  // payments

  handlePaymentBalanceSubscribe: InferHandler<'v1', HostApiProtocol['host_payment_balance_subscribe']>;
  handlePaymentTopUp: InferHandler<'v1', HostApiProtocol['host_payment_top_up']>;
  handlePaymentRequest: InferHandler<'v1', HostApiProtocol['host_payment_request']>;
  handlePaymentStatusSubscribe: InferHandler<'v1', HostApiProtocol['host_payment_status_subscribe']>;

  // chain interaction

  handleChainConnection: (factory: (genesisHash: HexString) => JsonRpcProvider | null) => VoidFunction;

  isReady(): Promise<boolean>;
  dispose(): void;

  subscribeProductConnectionStatus(callback: (connectionStatus: ConnectionStatus) => void): VoidFunction;
};
