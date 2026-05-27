export { SpektrExtensionName, WellKnownChain } from './constants.js';

export { sandboxProvider, sandboxTransport } from './sandboxTransport.js';

export { hostApi } from './hostApi.js';

export { createMetaProvider, metaProvider } from './metaProvider.js';

export { createLegacyExtensionEnableFactory, injectSpektrExtension } from './injectWeb3.js';
export { createPapiProvider } from './papiProvider.js';

export type {
  ChatBotRegistrationResult,
  ChatCustomMessageRenderer,
  ChatCustomMessageRendererParams,
  ChatMessageContent,
  ChatReceivedAction,
  ChatRoom,
  ChatRoomRegistrationResult,
} from './chat.js';
export { createProductChatManager, matchChatCustomRenderers } from './chat.js';

export type {
  ProductAccountId,
  SignedStatement,
  Statement,
  StatementTopicFilter,
  StatementsPage,
  Topic,
} from './statementStore.js';
export { createStatementStore } from './statementStore.js';

export type { AccountConnectionStatus, LegacyAccount, ProductAccount } from './accounts.js';
export { accounts, createAccountsProvider } from './accounts.js';

export type { ThemeMode } from './theme.js';
export { createThemeProvider } from './theme.js';

export { createLocalStorage, hostLocalStorage } from './localStorage.js';

export type { NotificationId, PushNotificationInput } from './notification.js';
export { createNotificationManager, notificationManager } from './notification.js';

export { createPreimageManager, preimageManager } from './preimage.js';

export type { PaymentBalance, PaymentStatus, PurseId, TopUpSource } from './payments.js';
export { createPaymentManager, paymentManager } from './payments.js';

export { deriveEntropy } from './deriveEntropy.js';

export type { DevicePermissionKind, RemotePermissionItem } from './permission.js';
export { requestDevicePermission, requestPermission } from './permission.js';
