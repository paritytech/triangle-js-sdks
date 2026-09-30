import type { EnumCodec } from '@novasamatech/scale';
import { Enum } from '@novasamatech/scale';
import type { Codec } from 'scale-ts';

import type { CallInterruptValue, CallResponseValue } from './callError.js';
import { callInterrupt, callResponse } from './callError.js';
import {
  AccountConnectionStatusV1_interrupt,
  AccountConnectionStatusV1_receive,
  AccountConnectionStatusV1_start,
  AccountCreateProofV1_error,
  AccountCreateProofV1_request,
  AccountCreateProofV1_response,
  AccountGetAliasV1_error,
  AccountGetAliasV1_request,
  AccountGetAliasV1_response,
  AccountGetV1_error,
  AccountGetV1_request,
  AccountGetV1_response,
  AccountListRingVrfKeysV1_error,
  AccountListRingVrfKeysV1_request,
  AccountListRingVrfKeysV1_response,
  AccountRegisterRingVrfKeyV1_error,
  AccountRegisterRingVrfKeyV1_request,
  AccountRegisterRingVrfKeyV1_response,
  AccountRingVrfSignV1_error,
  AccountRingVrfSignV1_request,
  AccountRingVrfSignV1_response,
  AccountSignVrfV1_error,
  AccountSignVrfV1_request,
  AccountSignVrfV1_response,
  GetLegacyAccountsV1_error,
  GetLegacyAccountsV1_request,
  GetLegacyAccountsV1_response,
  GetUserIdV1_error,
  GetUserIdV1_request,
  GetUserIdV1_response,
  RequestLoginV1_error,
  RequestLoginV1_request,
  RequestLoginV1_response,
} from './v1/accounts.js';
import {
  ChainHeadBodyV1_error,
  ChainHeadBodyV1_request,
  ChainHeadBodyV1_response,
  ChainHeadCallV1_error,
  ChainHeadCallV1_request,
  ChainHeadCallV1_response,
  ChainHeadContinueV1_error,
  ChainHeadContinueV1_request,
  ChainHeadContinueV1_response,
  ChainHeadFollowV1_interrupt,
  ChainHeadFollowV1_receive,
  ChainHeadFollowV1_start,
  ChainHeadHeaderV1_error,
  ChainHeadHeaderV1_request,
  ChainHeadHeaderV1_response,
  ChainHeadStopOperationV1_error,
  ChainHeadStopOperationV1_request,
  ChainHeadStopOperationV1_response,
  ChainHeadStorageV1_error,
  ChainHeadStorageV1_request,
  ChainHeadStorageV1_response,
  ChainHeadUnpinV1_error,
  ChainHeadUnpinV1_request,
  ChainHeadUnpinV1_response,
  ChainInfoV1_error,
  ChainInfoV1_request,
  ChainInfoV1_response,
  ChainSpecChainNameV1_error,
  ChainSpecChainNameV1_request,
  ChainSpecChainNameV1_response,
  ChainSpecGenesisHashV1_error,
  ChainSpecGenesisHashV1_request,
  ChainSpecGenesisHashV1_response,
  ChainSpecPropertiesV1_error,
  ChainSpecPropertiesV1_request,
  ChainSpecPropertiesV1_response,
  TransactionBroadcastV1_error,
  TransactionBroadcastV1_request,
  TransactionBroadcastV1_response,
  TransactionStopV1_error,
  TransactionStopV1_request,
  TransactionStopV1_response,
} from './v1/chainInteraction.js';
import {
  ChatActionSubscribeV1_interrupt,
  ChatActionSubscribeV1_receive,
  ChatActionSubscribeV1_start,
  ChatCreateRoomV1_error,
  ChatCreateRoomV1_request,
  ChatCreateRoomV1_response,
  ChatListSubscribeV1_interrupt,
  ChatListSubscribeV1_receive,
  ChatListSubscribeV1_start,
  ChatPostMessageV1_error,
  ChatPostMessageV1_request,
  ChatPostMessageV1_response,
  ChatRegisterBotV1_error,
  ChatRegisterBotV1_request,
  ChatRegisterBotV1_response,
} from './v1/chat.js';
import {
  CoinPaymentCreateChequeV1_error,
  CoinPaymentCreateChequeV1_request,
  CoinPaymentCreateChequeV1_response,
  CoinPaymentCreatePurseV1_error,
  CoinPaymentCreatePurseV1_request,
  CoinPaymentCreatePurseV1_response,
  CoinPaymentCreateReceivableV1_error,
  CoinPaymentCreateReceivableV1_request,
  CoinPaymentCreateReceivableV1_response,
  CoinPaymentDeletePurseV1_interrupt,
  CoinPaymentDeletePurseV1_receive,
  CoinPaymentDeletePurseV1_start,
  CoinPaymentDepositV1_interrupt,
  CoinPaymentDepositV1_receive,
  CoinPaymentDepositV1_start,
  CoinPaymentListenForPaymentV1_interrupt,
  CoinPaymentListenForPaymentV1_receive,
  CoinPaymentListenForPaymentV1_start,
  CoinPaymentQueryPurseV1_error,
  CoinPaymentQueryPurseV1_request,
  CoinPaymentQueryPurseV1_response,
  CoinPaymentRebalancePurseV1_interrupt,
  CoinPaymentRebalancePurseV1_receive,
  CoinPaymentRebalancePurseV1_start,
  CoinPaymentRefundV1_interrupt,
  CoinPaymentRefundV1_receive,
  CoinPaymentRefundV1_start,
} from './v1/coinPayment.js';
import { ContactsPickV1_error, ContactsPickV1_request, ContactsPickV1_response } from './v1/contacts.js';
import {
  CreateTransactionV1_error,
  CreateTransactionV1_request,
  CreateTransactionV1_response,
  CreateTransactionWithLegacyAccountV1_error,
  CreateTransactionWithLegacyAccountV1_request,
  CreateTransactionWithLegacyAccountV1_response,
} from './v1/createTransaction.js';
import { DeriveEntropyV1_error, DeriveEntropyV1_request, DeriveEntropyV1_response } from './v1/deriveEntropy.js';
import {
  DevicePermissionV1_error,
  DevicePermissionV1_request,
  DevicePermissionV1_response,
} from './v1/devicePermission.js';
import { FeatureV1_error, FeatureV1_request, FeatureV1_response } from './v1/feature.js';
import { HandshakeV1_error, HandshakeV1_request, HandshakeV1_response } from './v1/handshake.js';
import {
  StorageClearV1_error,
  StorageClearV1_request,
  StorageClearV1_response,
  StorageReadV1_error,
  StorageReadV1_request,
  StorageReadV1_response,
  StorageReadV2_error,
  StorageReadV2_request,
  StorageReadV2_response,
  StorageSubscribeV1_interrupt,
  StorageSubscribeV1_receive,
  StorageSubscribeV1_start,
  StorageWriteV1_error,
  StorageWriteV1_request,
  StorageWriteV1_response,
} from './v1/localStorage.js';
import { LocaleSubscribeV1_interrupt, LocaleSubscribeV1_receive, LocaleSubscribeV1_start } from './v1/locale.js';
import { NavigateToV1_error, NavigateToV1_request, NavigateToV1_response } from './v1/navigation.js';
import {
  PushNotificationCancelV1_error,
  PushNotificationCancelV1_request,
  PushNotificationCancelV1_response,
  PushNotificationV1_error,
  PushNotificationV1_request,
  PushNotificationV1_response,
} from './v1/notification.js';
import {
  PaymentBalanceSubscribeV1_interrupt,
  PaymentBalanceSubscribeV1_receive,
  PaymentBalanceSubscribeV1_start,
  PaymentRequestV1_error,
  PaymentRequestV1_request,
  PaymentRequestV1_response,
  PaymentStatusSubscribeV1_interrupt,
  PaymentStatusSubscribeV1_receive,
  PaymentStatusSubscribeV1_start,
  PaymentTopUpStatusSubscribeV1_interrupt,
  PaymentTopUpStatusSubscribeV1_receive,
  PaymentTopUpStatusSubscribeV1_start,
  PaymentTopUpV1_error,
  PaymentTopUpV1_request,
  PaymentTopUpV1_response,
} from './v1/payments.js';
import {
  PocketListSubscribeV1_interrupt,
  PocketListSubscribeV1_receive,
  PocketListSubscribeV1_start,
  PocketRemoveCardV1_error,
  PocketRemoveCardV1_request,
  PocketRemoveCardV1_response,
} from './v1/pocket.js';
import {
  PreimageLookupSubscribeV1_interrupt,
  PreimageLookupSubscribeV1_receive,
  PreimageLookupSubscribeV1_start,
  PreimageSubmitV1_error,
  PreimageSubmitV1_request,
  PreimageSubmitV1_response,
} from './v1/preimage.js';
import {
  RemotePermissionV1_error,
  RemotePermissionV1_request,
  RemotePermissionV1_response,
} from './v1/remotePermission.js';
import {
  RendererActionSubscribeV1_interrupt,
  RendererActionSubscribeV1_receive,
  RendererActionSubscribeV1_start,
  RendererRenderV1_interrupt,
  RendererRenderV1_receive,
  RendererRenderV1_start,
} from './v1/renderer.js';
import {
  RequestResourceAllocationV1_error,
  RequestResourceAllocationV1_request,
  RequestResourceAllocationV1_response,
} from './v1/resourceAllocation.js';
import {
  SignPayloadV1_error,
  SignPayloadV1_request,
  SignPayloadV1_response,
  SignPayloadWithLegacyAccountV1_error,
  SignPayloadWithLegacyAccountV1_request,
  SignPayloadWithLegacyAccountV1_response,
  SignRawV1_error,
  SignRawV1_request,
  SignRawV1_response,
  SignRawWithLegacyAccountV1_error,
  SignRawWithLegacyAccountV1_request,
  SignRawWithLegacyAccountV1_response,
} from './v1/sign.js';
import {
  StatementStoreCreateProofAuthorizedV1_error,
  StatementStoreCreateProofAuthorizedV1_request,
  StatementStoreCreateProofAuthorizedV1_response,
  StatementStoreCreateProofV1_error,
  StatementStoreCreateProofV1_request,
  StatementStoreCreateProofV1_response,
  StatementStoreSubmitV1_error,
  StatementStoreSubmitV1_request,
  StatementStoreSubmitV1_response,
  StatementStoreSubscribeV1_interrupt,
  StatementStoreSubscribeV1_receive,
  StatementStoreSubscribeV1_start,
} from './v1/statementStore.js';
import {
  GetProductContextV1_error,
  GetProductContextV1_request,
  GetProductContextV1_response,
  HostInfoV1_error,
  HostInfoV1_request,
  HostInfoV1_response,
} from './v1/system.js';
import { ThemeSubscribeV1_interrupt, ThemeSubscribeV1_receive, ThemeSubscribeV1_start } from './v1/theme.js';
import {
  WorkerBeginOperationV1_error,
  WorkerBeginOperationV1_request,
  WorkerBeginOperationV1_response,
  WorkerEndOperationV1_error,
  WorkerEndOperationV1_request,
  WorkerEndOperationV1_response,
} from './v1/worker.js';

// helpers

/**
 * The codecs of one version of a method: `[request, response, error]` for a
 * request/response method, `[start, receive, error]` for a subscription. Each
 * leg becomes its own versioned wrapper on the wire (`v1` → index 0, `v2` → 1,
 * …), exactly as truapi's `versioned_type!` lays them out.
 */
export type VersionLegs = readonly [Codec<any>, Codec<any>, Codec<any>];
export type VersionedLegs = Record<string, VersionLegs>;

type Leg<V extends VersionedLegs, N extends 0 | 1 | 2> = { [K in keyof V & string]: V[K][N] };

/** Which side opens a subscription. Host-initiated ones are started by the host and served by the product. */
export type Initiator = 'product' | 'host';

export type VersionedProtocolRequest<V extends VersionedLegs = VersionedLegs, Internal extends boolean = boolean> = {
  kind: 'request';
  /** Host-internal methods are dispatched by hosts but kept off the product-facing `HostApi`. */
  internal: Internal;
  /** Wire method discriminant within the trait. */
  id: number;
  /** Version tags, oldest first. */
  tags: readonly (keyof V & string)[];
  request: EnumCodec<Leg<V, 0>>;
  response: Codec<CallResponseValue<Leg<V, 1>, Leg<V, 2>>>;
};

export type VersionedProtocolSubscription<V extends VersionedLegs = VersionedLegs, I extends Initiator = Initiator> = {
  kind: 'subscription';
  /** Wire method discriminant within the trait. */
  id: number;
  /** Version tags, oldest first. */
  tags: readonly (keyof V & string)[];
  initiator: I;
  start: EnumCodec<Leg<V, 0>>;
  receive: EnumCodec<Leg<V, 1>>;
  interrupt: Codec<CallInterruptValue<Leg<V, 2>>>;
};

export type VersionedProtocolMethod = VersionedProtocolRequest<any> | VersionedProtocolSubscription<any>;

export type ProtocolTrait<
  Methods extends Record<string, VersionedProtocolMethod> = Record<string, VersionedProtocolMethod>,
> = {
  /** Wire trait discriminant. */
  id: number;
  methods: Methods;
};

const leg = <const V extends VersionedLegs, const N extends 0 | 1 | 2>(versions: V, n: N) =>
  Object.fromEntries(Object.entries(versions).map(([tag, legs]) => [tag, legs[n]])) as Leg<V, N>;

const request = <const V extends VersionedLegs, const Internal extends boolean = false>(
  id: number,
  versions: V,
  internal: Internal = false as Internal,
): VersionedProtocolRequest<V, Internal> => ({
  kind: 'request',
  internal,
  id,
  tags: Object.keys(versions),
  request: Enum(leg(versions, 0)),
  response: callResponse(leg(versions, 1), leg(versions, 2)),
});

const subscription = <const V extends VersionedLegs, const I extends Initiator = 'product'>(
  id: number,
  versions: V,
  initiator: I = 'product' as I,
): VersionedProtocolSubscription<V, I> => ({
  kind: 'subscription',
  id,
  tags: Object.keys(versions),
  initiator,
  start: Enum(leg(versions, 0)),
  receive: Enum(leg(versions, 1)),
  interrupt: callInterrupt(leg(versions, 2)),
});

const defineTrait = <const Methods extends Record<string, VersionedProtocolMethod>>(
  id: number,
  methods: Methods,
): ProtocolTrait<Methods> => ({ id, methods });

// actual api
//
// Trait ids, method ids and per-trait method order mirror truapi's
// `generated/wire_table.rs` and are part of the wire protocol: only ever append
// within a trait, and never reuse a removed id.

export type HostApiProtocol = typeof hostApiProtocol;

export const hostApiProtocol = {
  system: defineTrait(1, {
    handshake: request(0, { v1: [HandshakeV1_request, HandshakeV1_response, HandshakeV1_error] }),
    featureSupported: request(1, { v1: [FeatureV1_request, FeatureV1_response, FeatureV1_error] }),
    navigateTo: request(2, { v1: [NavigateToV1_request, NavigateToV1_response, NavigateToV1_error] }),
    info: request(3, { v1: [HostInfoV1_request, HostInfoV1_response, HostInfoV1_error] }),
    getProductContext: request(4, {
      v1: [GetProductContextV1_request, GetProductContextV1_response, GetProductContextV1_error],
    }),
  }),

  account: defineTrait(2, {
    connectionStatusSubscribe: subscription(0, {
      v1: [AccountConnectionStatusV1_start, AccountConnectionStatusV1_receive, AccountConnectionStatusV1_interrupt],
    }),
    getAccount: request(1, { v1: [AccountGetV1_request, AccountGetV1_response, AccountGetV1_error] }),
    getAccountAlias: request(2, {
      v1: [AccountGetAliasV1_request, AccountGetAliasV1_response, AccountGetAliasV1_error],
    }),
    createAccountProof: request(3, {
      v1: [AccountCreateProofV1_request, AccountCreateProofV1_response, AccountCreateProofV1_error],
    }),
    getLegacyAccounts: request(4, {
      v1: [GetLegacyAccountsV1_request, GetLegacyAccountsV1_response, GetLegacyAccountsV1_error],
    }),
    getUserId: request(5, { v1: [GetUserIdV1_request, GetUserIdV1_response, GetUserIdV1_error] }),
    requestLogin: request(6, { v1: [RequestLoginV1_request, RequestLoginV1_response, RequestLoginV1_error] }),
    signVrf: request(7, { v1: [AccountSignVrfV1_request, AccountSignVrfV1_response, AccountSignVrfV1_error] }),
    registerRingVrfKey: request(8, {
      v1: [
        AccountRegisterRingVrfKeyV1_request,
        AccountRegisterRingVrfKeyV1_response,
        AccountRegisterRingVrfKeyV1_error,
      ],
    }),
    listRingVrfKeys: request(9, {
      v1: [AccountListRingVrfKeysV1_request, AccountListRingVrfKeysV1_response, AccountListRingVrfKeysV1_error],
    }),
    ringVrfSign: request(10, {
      v1: [AccountRingVrfSignV1_request, AccountRingVrfSignV1_response, AccountRingVrfSignV1_error],
    }),
  }),

  chain: defineTrait(3, {
    followHeadSubscribe: subscription(0, {
      v1: [ChainHeadFollowV1_start, ChainHeadFollowV1_receive, ChainHeadFollowV1_interrupt],
    }),
    getHeadHeader: request(1, { v1: [ChainHeadHeaderV1_request, ChainHeadHeaderV1_response, ChainHeadHeaderV1_error] }),
    getHeadBody: request(2, { v1: [ChainHeadBodyV1_request, ChainHeadBodyV1_response, ChainHeadBodyV1_error] }),
    getHeadStorage: request(3, {
      v1: [ChainHeadStorageV1_request, ChainHeadStorageV1_response, ChainHeadStorageV1_error],
    }),
    callHead: request(4, { v1: [ChainHeadCallV1_request, ChainHeadCallV1_response, ChainHeadCallV1_error] }),
    unpinHead: request(5, { v1: [ChainHeadUnpinV1_request, ChainHeadUnpinV1_response, ChainHeadUnpinV1_error] }),
    continueHead: request(6, {
      v1: [ChainHeadContinueV1_request, ChainHeadContinueV1_response, ChainHeadContinueV1_error],
    }),
    stopHeadOperation: request(7, {
      v1: [ChainHeadStopOperationV1_request, ChainHeadStopOperationV1_response, ChainHeadStopOperationV1_error],
    }),
    getSpecGenesisHash: request(8, {
      v1: [ChainSpecGenesisHashV1_request, ChainSpecGenesisHashV1_response, ChainSpecGenesisHashV1_error],
    }),
    getSpecChainName: request(9, {
      v1: [ChainSpecChainNameV1_request, ChainSpecChainNameV1_response, ChainSpecChainNameV1_error],
    }),
    getSpecProperties: request(10, {
      v1: [ChainSpecPropertiesV1_request, ChainSpecPropertiesV1_response, ChainSpecPropertiesV1_error],
    }),
    broadcastTransaction: request(11, {
      v1: [TransactionBroadcastV1_request, TransactionBroadcastV1_response, TransactionBroadcastV1_error],
    }),
    stopTransaction: request(12, {
      v1: [TransactionStopV1_request, TransactionStopV1_response, TransactionStopV1_error],
    }),
    getChainInfo: request(13, { v1: [ChainInfoV1_request, ChainInfoV1_response, ChainInfoV1_error] }),
  }),

  chat: defineTrait(4, {
    createRoom: request(0, { v1: [ChatCreateRoomV1_request, ChatCreateRoomV1_response, ChatCreateRoomV1_error] }),
    registerBot: request(1, {
      v1: [ChatRegisterBotV1_request, ChatRegisterBotV1_response, ChatRegisterBotV1_error],
    }),
    listSubscribe: subscription(2, {
      v1: [ChatListSubscribeV1_start, ChatListSubscribeV1_receive, ChatListSubscribeV1_interrupt],
    }),
    postMessage: request(3, {
      v1: [ChatPostMessageV1_request, ChatPostMessageV1_response, ChatPostMessageV1_error],
    }),
    actionSubscribe: subscription(4, {
      v1: [ChatActionSubscribeV1_start, ChatActionSubscribeV1_receive, ChatActionSubscribeV1_interrupt],
    }),
    // Id 5 (the retired `custom_message_render`) is spent; `renderer.render` replaced it.
  }),

  // RFC 0017 CoinPayment.
  coinPayment: defineTrait(5, {
    createPurse: request(0, {
      v1: [CoinPaymentCreatePurseV1_request, CoinPaymentCreatePurseV1_response, CoinPaymentCreatePurseV1_error],
    }),
    queryPurse: request(1, {
      v1: [CoinPaymentQueryPurseV1_request, CoinPaymentQueryPurseV1_response, CoinPaymentQueryPurseV1_error],
    }),
    rebalancePurse: subscription(2, {
      v1: [
        CoinPaymentRebalancePurseV1_start,
        CoinPaymentRebalancePurseV1_receive,
        CoinPaymentRebalancePurseV1_interrupt,
      ],
    }),
    deletePurse: subscription(3, {
      v1: [CoinPaymentDeletePurseV1_start, CoinPaymentDeletePurseV1_receive, CoinPaymentDeletePurseV1_interrupt],
    }),
    createReceivable: request(4, {
      v1: [
        CoinPaymentCreateReceivableV1_request,
        CoinPaymentCreateReceivableV1_response,
        CoinPaymentCreateReceivableV1_error,
      ],
    }),
    createCheque: request(5, {
      v1: [CoinPaymentCreateChequeV1_request, CoinPaymentCreateChequeV1_response, CoinPaymentCreateChequeV1_error],
    }),
    deposit: subscription(6, {
      v1: [CoinPaymentDepositV1_start, CoinPaymentDepositV1_receive, CoinPaymentDepositV1_interrupt],
    }),
    refund: subscription(7, {
      v1: [CoinPaymentRefundV1_start, CoinPaymentRefundV1_receive, CoinPaymentRefundV1_interrupt],
    }),
    listenForPayment: subscription(8, {
      v1: [
        CoinPaymentListenForPaymentV1_start,
        CoinPaymentListenForPaymentV1_receive,
        CoinPaymentListenForPaymentV1_interrupt,
      ],
    }),
  }),

  entropy: defineTrait(6, {
    derive: request(0, { v1: [DeriveEntropyV1_request, DeriveEntropyV1_response, DeriveEntropyV1_error] }),
  }),

  localStorage: defineTrait(7, {
    read: request(0, {
      v1: [StorageReadV1_request, StorageReadV1_response, StorageReadV1_error],
      v2: [StorageReadV2_request, StorageReadV2_response, StorageReadV2_error],
    }),
    write: request(1, { v1: [StorageWriteV1_request, StorageWriteV1_response, StorageWriteV1_error] }),
    clear: request(2, { v1: [StorageClearV1_request, StorageClearV1_response, StorageClearV1_error] }),
    subscribe: subscription(3, {
      v1: [StorageSubscribeV1_start, StorageSubscribeV1_receive, StorageSubscribeV1_interrupt],
    }),
  }),

  notifications: defineTrait(8, {
    sendPushNotification: request(0, {
      v1: [PushNotificationV1_request, PushNotificationV1_response, PushNotificationV1_error],
    }),
    cancelPushNotification: request(1, {
      v1: [PushNotificationCancelV1_request, PushNotificationCancelV1_response, PushNotificationCancelV1_error],
    }),
  }),

  // The payment shapes follow this SDK's 0.11/0.12 releases (product-supplied
  // ids, idempotent top up and request), which are ahead of truapi's.
  payment: defineTrait(9, {
    balanceSubscribe: subscription(0, {
      v1: [PaymentBalanceSubscribeV1_start, PaymentBalanceSubscribeV1_receive, PaymentBalanceSubscribeV1_interrupt],
    }),
    topUp: request(1, { v1: [PaymentTopUpV1_request, PaymentTopUpV1_response, PaymentTopUpV1_error] }),
    request: request(2, { v1: [PaymentRequestV1_request, PaymentRequestV1_response, PaymentRequestV1_error] }),
    statusSubscribe: subscription(3, {
      v1: [PaymentStatusSubscribeV1_start, PaymentStatusSubscribeV1_receive, PaymentStatusSubscribeV1_interrupt],
    }),
    // Not in truapi yet — SDK-only, appended after truapi's last payment method.
    topUpStatusSubscribe: subscription(4, {
      v1: [
        PaymentTopUpStatusSubscribeV1_start,
        PaymentTopUpStatusSubscribeV1_receive,
        PaymentTopUpStatusSubscribeV1_interrupt,
      ],
    }),
  }),

  permissions: defineTrait(10, {
    requestDevicePermission: request(0, {
      v1: [DevicePermissionV1_request, DevicePermissionV1_response, DevicePermissionV1_error],
    }),
    requestRemotePermission: request(1, {
      v1: [RemotePermissionV1_request, RemotePermissionV1_response, RemotePermissionV1_error],
    }),
    // Host-internal: authorize a permission for a product without prompting
    // the product. Kept off the product-facing `HostApi`.
    authorizeRemotePermission: request(
      2,
      { v1: [RemotePermissionV1_request, RemotePermissionV1_response, RemotePermissionV1_error] },
      true,
    ),
    authorizeDevicePermission: request(
      3,
      { v1: [DevicePermissionV1_request, DevicePermissionV1_response, DevicePermissionV1_error] },
      true,
    ),
  }),

  preimage: defineTrait(11, {
    lookupSubscribe: subscription(0, {
      v1: [PreimageLookupSubscribeV1_start, PreimageLookupSubscribeV1_receive, PreimageLookupSubscribeV1_interrupt],
    }),
    submit: request(1, { v1: [PreimageSubmitV1_request, PreimageSubmitV1_response, PreimageSubmitV1_error] }),
  }),

  resourceAllocation: defineTrait(12, {
    request: request(0, {
      v1: [
        RequestResourceAllocationV1_request,
        RequestResourceAllocationV1_response,
        RequestResourceAllocationV1_error,
      ],
    }),
  }),

  signing: defineTrait(13, {
    createTransaction: request(0, {
      v1: [CreateTransactionV1_request, CreateTransactionV1_response, CreateTransactionV1_error],
    }),
    createTransactionWithLegacyAccount: request(1, {
      v1: [
        CreateTransactionWithLegacyAccountV1_request,
        CreateTransactionWithLegacyAccountV1_response,
        CreateTransactionWithLegacyAccountV1_error,
      ],
    }),
    signRawWithLegacyAccount: request(2, {
      v1: [SignRawWithLegacyAccountV1_request, SignRawWithLegacyAccountV1_response, SignRawWithLegacyAccountV1_error],
    }),
    signPayloadWithLegacyAccount: request(3, {
      v1: [
        SignPayloadWithLegacyAccountV1_request,
        SignPayloadWithLegacyAccountV1_response,
        SignPayloadWithLegacyAccountV1_error,
      ],
    }),
    signRaw: request(4, { v1: [SignRawV1_request, SignRawV1_response, SignRawV1_error] }),
    signPayload: request(5, { v1: [SignPayloadV1_request, SignPayloadV1_response, SignPayloadV1_error] }),
    // Signs raw bytes without the `<Bytes>` watermark. Deprecated on arrival:
    // only for integrations that cannot verify watermarked signatures.
    signRawUnwatermarkedDeprecated: request(6, {
      v1: [SignRawV1_request, SignRawV1_response, SignRawV1_error],
    }),
    signRawUnwatermarkedDeprecatedWithLegacyAccount: request(7, {
      v1: [SignRawWithLegacyAccountV1_request, SignRawWithLegacyAccountV1_response, SignRawWithLegacyAccountV1_error],
    }),
  }),

  statementStore: defineTrait(14, {
    subscribe: subscription(0, {
      v1: [StatementStoreSubscribeV1_start, StatementStoreSubscribeV1_receive, StatementStoreSubscribeV1_interrupt],
    }),
    createProof: request(1, {
      v1: [
        StatementStoreCreateProofV1_request,
        StatementStoreCreateProofV1_response,
        StatementStoreCreateProofV1_error,
      ],
    }),
    submit: request(2, {
      v1: [StatementStoreSubmitV1_request, StatementStoreSubmitV1_response, StatementStoreSubmitV1_error],
    }),
    createProofAuthorized: request(3, {
      v1: [
        StatementStoreCreateProofAuthorizedV1_request,
        StatementStoreCreateProofAuthorizedV1_response,
        StatementStoreCreateProofAuthorizedV1_error,
      ],
    }),
  }),

  theme: defineTrait(15, {
    subscribe: subscription(0, {
      v1: [ThemeSubscribeV1_start, ThemeSubscribeV1_receive, ThemeSubscribeV1_interrupt],
    }),
  }),

  locale: defineTrait(16, {
    subscribe: subscription(0, {
      v1: [LocaleSubscribeV1_start, LocaleSubscribeV1_receive, LocaleSubscribeV1_interrupt],
    }),
  }),

  renderer: defineTrait(17, {
    // Host-initiated: the host asks the product to draw a body and the product
    // streams renderer trees back until either side ends it.
    render: subscription(
      0,
      { v1: [RendererRenderV1_start, RendererRenderV1_receive, RendererRenderV1_interrupt] },
      'host',
    ),
    actionSubscribe: subscription(1, {
      v1: [RendererActionSubscribeV1_start, RendererActionSubscribeV1_receive, RendererActionSubscribeV1_interrupt],
    }),
  }),

  pocket: defineTrait(18, {
    listSubscribe: subscription(0, {
      v1: [PocketListSubscribeV1_start, PocketListSubscribeV1_receive, PocketListSubscribeV1_interrupt],
    }),
    removeCard: request(1, { v1: [PocketRemoveCardV1_request, PocketRemoveCardV1_response, PocketRemoveCardV1_error] }),
  }),

  worker: defineTrait(19, {
    beginOperation: request(0, {
      v1: [WorkerBeginOperationV1_request, WorkerBeginOperationV1_response, WorkerBeginOperationV1_error],
    }),
    endOperation: request(1, {
      v1: [WorkerEndOperationV1_request, WorkerEndOperationV1_response, WorkerEndOperationV1_error],
    }),
  }),

  contacts: defineTrait(20, {
    pick: request(0, { v1: [ContactsPickV1_request, ContactsPickV1_response, ContactsPickV1_error] }),
  }),
} as const;

// type-level accessors

export type TraitName = keyof HostApiProtocol & string;
export type MethodName<T extends TraitName> = keyof HostApiProtocol[T]['methods'] & string;
export type ProtocolMethod<T extends TraitName, M extends MethodName<T>> = HostApiProtocol[T]['methods'][M];

export type RequestMethodName<T extends TraitName> = {
  [M in MethodName<T>]: ProtocolMethod<T, M> extends VersionedProtocolRequest<any> ? M : never;
}[MethodName<T>];

export type SubscriptionMethodName<T extends TraitName> = {
  [M in MethodName<T>]: ProtocolMethod<T, M> extends VersionedProtocolSubscription<any> ? M : never;
}[MethodName<T>];

type Decoded<Def, Leg extends string> = Def extends { [K in Leg]: { dec: (...args: any[]) => infer V } } ? V : never;

export type RequestPayload<T extends TraitName, M extends RequestMethodName<T>> = Decoded<
  ProtocolMethod<T, M>,
  'request'
>;
export type ResponsePayload<T extends TraitName, M extends RequestMethodName<T>> = Decoded<
  ProtocolMethod<T, M>,
  'response'
>;
export type StartPayload<T extends TraitName, M extends SubscriptionMethodName<T>> = Decoded<
  ProtocolMethod<T, M>,
  'start'
>;
export type ReceivePayload<T extends TraitName, M extends SubscriptionMethodName<T>> = Decoded<
  ProtocolMethod<T, M>,
  'receive'
>;
export type InterruptPayload<T extends TraitName, M extends SubscriptionMethodName<T>> = Decoded<
  ProtocolMethod<T, M>,
  'interrupt'
>;

// runtime lookup by wire address

export type ProtocolAddress = {
  trait: TraitName;
  method: string;
  traitId: number;
  methodId: number;
  definition: VersionedProtocolMethod;
};

const addressKey = (traitId: number, methodId: number) => (traitId << 8) | methodId;

const addressesByKey = new Map<number, ProtocolAddress>();
for (const [trait, { id: traitId, methods }] of Object.entries(hostApiProtocol) as [TraitName, ProtocolTrait][]) {
  for (const [method, definition] of Object.entries(methods)) {
    const key = addressKey(traitId, definition.id);
    const existing = addressesByKey.get(key);
    if (existing) {
      throw new Error(
        `Wire address (${traitId}, ${definition.id}) is taken by both ${existing.trait}.${existing.method} and ${trait}.${method}`,
      );
    }
    addressesByKey.set(key, { trait, method, traitId, methodId: definition.id, definition });
  }
}

/** Resolve a `(trait, method)` wire address to its protocol method, if this build knows it. */
export function lookupAddress(traitId: number, methodId: number): ProtocolAddress | undefined {
  return addressesByKey.get(addressKey(traitId, methodId));
}

/** Resolve a protocol method by name. */
export function resolveMethod<const T extends TraitName, const M extends MethodName<T>>(trait: T, method: M) {
  const traitDef = hostApiProtocol[trait] as ProtocolTrait;
  const definition = traitDef.methods[method];
  if (!definition) {
    throw new Error(`Unknown host api method ${trait}.${method}`);
  }
  return { traitId: traitDef.id, methodId: definition.id, definition: definition as ProtocolMethod<T, M> };
}
