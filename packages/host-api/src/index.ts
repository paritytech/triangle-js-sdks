export type {
  ConnectionStatus,
  DebugMessageEvent,
  HostApiMethod,
  Logger,
  RequestHandler,
  Subscription,
  SubscriptionHandler,
  Transport,
} from './types.js';
export type { MessagePayloadSchema } from './protocol/messageCodec.js';
export type { Provider } from './provider.js';
export { createRequestId } from './helpers.js';

export type { HostApi } from './hostApi.js';
export { createHostApi } from './hostApi.js';
export { createTransport } from './transport.js';
export { createDefaultLogger } from './logger.js';

export type { HostApiProtocol, VersionedProtocolRequest, VersionedProtocolSubscription } from './protocol/impl.js';
export { hostApiProtocol } from './protocol/impl.js';

// External reexports
export type { Codec, CodecType } from 'scale-ts';

export type { HexString } from '@novasamatech/scale';
export {
  assertEnumVariant,
  enumValue,
  fromHex,
  isEnumVariant,
  resultErr,
  resultOk,
  toHex,
  unwrapResultOrThrow,
} from '@novasamatech/scale';

// Codecs

export { GenericError } from './protocol/commonCodecs.js';
export { CreateTransactionErr, LegacyTransaction, ProductAccountTransaction } from './protocol/v1/createTransaction.js';
export {
  AccountConnectionStatus,
  AccountId,
  ContextualAlias,
  CreateProofErr,
  DerivationIndex,
  DotNsIdentifier,
  GetUserIdErr,
  LegacyAccount,
  LoginErr,
  LoginResult,
  ProductAccount,
  ProductAccountId,
  RequestCredentialsErr,
  RingLocation,
  UserIdentity,
} from './protocol/v1/accounts.js';
export {
  ChatActionPayload,
  ChatBotRegistrationErr,
  ChatBotRegistrationStatus,
  ChatMessageContent,
  ChatMessagePostingErr,
  ChatRoom,
  ChatRoomRegistrationErr,
  ChatRoomRegistrationResult,
  ChatRoomRegistrationStatus,
  ReceivedChatAction,
} from './protocol/v1/chat.js';
export { DeriveEntropyErr } from './protocol/v1/deriveEntropy.js';
export { HandshakeErr } from './protocol/v1/handshake.js';
export {
  SigningErr,
  SigningPayload,
  SigningPayloadWithoutAccount,
  SigningRawPayload,
  SigningRawPayloadWithoutAccount,
  SigningResult,
} from './protocol/v1/sign.js';
export {
  SignedStatement,
  SignedStatementsPage,
  Statement,
  StatementProofErr,
  Topic,
  TopicFilter,
} from './protocol/v1/statementStore.js';
export { StorageErr } from './protocol/v1/localStorage.js';
export { DevicePermission } from './protocol/v1/devicePermission.js';
export { RemotePermission } from './protocol/v1/remotePermission.js';
export { NotificationId, PushNotification, PushNotificationError } from './protocol/v1/notification.js';
export { NavigateToErr } from './protocol/v1/navigation.js';
export { PreimageKey, PreimageSubmitErr, PreimageValue } from './protocol/v1/preimage.js';
export { AllocatableResource, AllocationOutcome, ResourceAllocationErr } from './protocol/v1/resourceAllocation.js';
export {
  PaymentBalance,
  PaymentBalanceErr,
  PaymentId,
  PaymentReceipt,
  PaymentRequestErr,
  PaymentStatus,
  PaymentStatusErr,
  PaymentTopUpErr,
  PaymentTopUpSource,
} from './protocol/v1/payments.js';
export {
  Arrangement,
  BorderStyle,
  ButtonVariant,
  ColorToken,
  ContentAlignment,
  CustomRendererNode,
  Dimensions,
  HorizontalAlignment,
  Modifier,
  Shape,
  Size,
  TypographyStyle,
  VerticalAlignment,
} from './protocol/v1/customRenderer.js';
export {
  ChainHeadEvent,
  ChainHeadFollowV1_start,
  OperationStartedResult,
  RuntimeType,
  StorageQueryItem,
  StorageQueryType,
  StorageResultItem,
  TransactionBroadcastV1_request,
  TransactionBroadcastV1_response,
  TransactionStopV1_request,
  TransactionStopV1_response,
} from './protocol/v1/chainInteraction.js';
export { Theme, ThemeName, ThemeVariant } from './protocol/v1/theme.js';
