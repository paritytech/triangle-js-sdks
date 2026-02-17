export type { ConnectionStatus, Logger, Subscription, Transport } from './types.js';
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
export { CreateTransactionErr, VersionedPublicTxPayload } from './protocol/v1/createTransaction.js';
export {
  Account,
  AccountId,
  CreateProofErr,
  ProductAccountId,
  RequestCredentialsErr,
  RingLocation,
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
export { HandshakeErr } from './protocol/v1/handshake.js';
export { SigningErr } from './protocol/v1/sign.js';
export { SignedStatement, Statement, StatementProofErr, Topic } from './protocol/v1/statementStore.js';
export { StorageErr } from './protocol/v1/localStorage.js';
export { DevicePermissionRequest } from './protocol/v1/devicePermission.js';
export { RemotePermissionRequest } from './protocol/v1/remotePermission.js';
export { PushNotification } from './protocol/v1/notification.js';
export { NavigateToErr } from './protocol/v1/navigation.js';
export { PreimageKey, PreimageSubmitErr, PreimageValue } from './protocol/v1/preimage.js';
