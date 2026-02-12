import type {
  Codec,
  CodecType,
  ConnectionStatus,
  HexString,
  HostApiProtocol,
  VersionedProtocolRequest,
  VersionedProtocolSubscription,
} from '@novasamatech/host-api';
import type { JsonRpcProvider } from '@polkadot-api/json-rpc-provider';
import type { ResultAsync, errAsync } from 'neverthrow';
import { okAsync } from 'neverthrow';

type SuccessResponse<T> = T extends { success: true; value: infer U } ? U : never;
type ErrorResponse<T> = T extends { success: false; value: infer U } ? U : never;

type Value<T extends Codec<any> | Codec<never>> = T extends Codec<any> ? CodecType<T> : unknown;
type OrPromise<T> = T | Promise<T>;
type ExtractEnumValue<T> = T extends { tag: string; value: infer V } ? V : never;
type WithVersion<V extends string, T> = ExtractEnumValue<Extract<T, { tag: V }>>;

type UnwrapSuccessResponse<V extends string, T> = T extends { tag: infer Tag; value: infer Value }
  ? WithVersion<V, { tag: Tag; value: SuccessResponse<Value> }>
  : never;

type UnwrapErrorResponse<V extends string, T> = T extends { tag: infer Tag; value: infer Value }
  ? WithVersion<V, { tag: Tag; value: ErrorResponse<Value> }>
  : never;

type UnwrapVersionedResult<V extends string, T> = T extends { tag: infer Tag; value: infer Value }
  ? ResultAsync<
      WithVersion<V, { tag: Tag; value: SuccessResponse<Value> }>,
      WithVersion<V, { tag: Tag; value: ErrorResponse<Value> }>
    >
  : never;

type InferRequestHandler<V extends string, T extends VersionedProtocolRequest> = (
  callback: (
    params: WithVersion<V, Value<T['request']>>,
    helpers: {
      ok: typeof okAsync<UnwrapSuccessResponse<V, Value<T['response']>>>;
      err: typeof errAsync<never, UnwrapErrorResponse<V, Value<T['response']>>>;
    },
  ) => OrPromise<UnwrapVersionedResult<V, Value<T['response']>>>,
) => VoidFunction;

type InferSubscribeHandler<V extends string, T extends VersionedProtocolSubscription> = (
  callback: (
    params: WithVersion<V, Value<T['start']>>,
    send: (payload: WithVersion<V, Value<T['receive']>>) => void,
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

  handleFeature: InferHandler<'v1', HostApiProtocol['feature']>;

  // storage

  handleLocalStorageRead: InferHandler<'v1', HostApiProtocol['local_storage_read']>;
  handleLocalStorageWrite: InferHandler<'v1', HostApiProtocol['local_storage_write']>;
  handleLocalStorageClear: InferHandler<'v1', HostApiProtocol['local_storage_clear']>;

  // accounts

  handleAccountGet: InferHandler<'v1', HostApiProtocol['account_get']>;
  handleAccountGetAlias: InferHandler<'v1', HostApiProtocol['account_get_alias']>;
  handleAccountCreateProof: InferHandler<'v1', HostApiProtocol['account_create_proof']>;
  handleGetNonProductAccounts: InferHandler<'v1', HostApiProtocol['get_non_product_accounts']>;

  // signing

  handleCreateTransaction: InferHandler<'v1', HostApiProtocol['create_transaction']>;
  handleCreateTransactionWithNonProductAccount: InferHandler<
    'v1',
    HostApiProtocol['create_transaction_with_non_product_account']
  >;
  handleSignRaw: InferHandler<'v1', HostApiProtocol['sign_raw']>;
  handleSignPayload: InferHandler<'v1', HostApiProtocol['sign_payload']>;

  // chat

  handleChatCreateRoom: InferHandler<'v1', HostApiProtocol['chat_create_room']>;
  handleChatBotRegistration: InferHandler<'v1', HostApiProtocol['chat_register_bot']>;
  handleChatListSubscribe: InferHandler<'v1', HostApiProtocol['chat_list_subscribe']>;
  handleChatPostMessage: InferHandler<'v1', HostApiProtocol['chat_post_message']>;
  handleChatActionSubscribe: InferHandler<'v1', HostApiProtocol['chat_action_subscribe']>;

  // statement store

  handleStatementStoreQuery: InferHandler<'v1', HostApiProtocol['statement_store_query']>;
  handleStatementStoreSubscribe: InferHandler<'v1', HostApiProtocol['statement_store_subscribe']>;
  handleStatementStoreCreateProof: InferHandler<'v1', HostApiProtocol['statement_store_create_proof']>;
  handleStatementStoreSubmit: InferHandler<'v1', HostApiProtocol['statement_store_submit']>;

  handleChainConnection: (factory: (genesisHash: HexString) => JsonRpcProvider | null) => VoidFunction;

  isReady(): Promise<boolean>;
  dispose(): void;

  subscribeProductConnectionStatus(callback: (connectionStatus: ConnectionStatus) => void): VoidFunction;
};
