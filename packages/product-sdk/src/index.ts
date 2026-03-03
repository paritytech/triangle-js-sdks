export { SpektrExtensionName, WellKnownChain } from './constants.js';

export { sandboxProvider, sandboxTransport } from './sandboxTransport.js';

export { hostApi } from './hostApi.js';

export { createMetaProvider, metaProvider } from './metaProvider.js';

export { createNonProductExtensionEnableFactory, injectSpektrExtension } from './injectWeb3.js';
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

export type { ProductAccountId, SignedStatement, Statement, Topic } from './statementStore.js';
export { createStatementStore } from './statementStore.js';

export type { AccountConnectionStatus, ProductAccount } from './accounts.js';
export { createAccountsProvider } from './accounts.js';

export { createLocalStorage, hostLocalStorage } from './localStorage.js';

export { createPreimageManager, preimageManager } from './preimage.js';
