# @novasamatech/product-sdk

An easy way to embed Polkadot host functionality into your dapp.

## Overview

Product SDK provides a set of tools to integrate your application with any Polkadot host application.
Core features:
- Generic injectWeb3 provider similar to [polkadot-js extension](https://polkadot.js.org/extension/)
- Chat module integration
- Statement store integration
- Accounts provider for product accounts and signing
- Redirect [PAPI](https://papi.how/) requests to host application
- Receive additional information from host application - supported chains, theme, etc.
- Local storage for persisting data in the host application
- Preimage manager for looking up and submitting preimages

## Installation

```shell
npm install @novasamatech/product-sdk --save -E
```

## Usage

### Injecting account provider into `injectedWeb3` interface

Product SDK can provide account information and signers with the same interface as any other Polkadot-compatible wallet.

```ts
import { injectSpektrExtension, SpektrExtensionName } from '@novasamatech/product-sdk';
import { connectInjectedExtension, type InjectedPolkadotAccount } from '@polkadot-api/pjs-signer';

async function getSpektrExtension() {
  const ready = await injectSpektrExtension();

  if (ready) {
    return connectInjectedExtension(SpektrExtensionName)
  }

  return null;
}

async function getAccounts(): Promise<InjectedPolkadotAccount[]> {
  const extension = await getSpektrExtension();

  if (extension) {
    return extension.getAccounts()
  }

  // fallback to other providers
  return [];
}
```

### Redirecting PAPI requests to host application

You can wrap your PAPI provider with Spektr provider to support redirecting requests to the host application.

```diff
import { createClient, type PolkadotClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws-provider';
import { createPapiProvider, WellKnownChain } from '@novasamatech/product-sdk';

function createPapiClient(): PolkadotClient {
  const polkadotEndpoint = 'wss://...';

-  const provider = getWsProvider(polkadotEndpoint);
+  const provider = createPapiProvider({
+    chainId: WellKnownChain.polkadotRelay,
+    fallback: getWsProvider(polkadotEndpoint),
+  });

  return createClient(provider);
}
```

### Subscribing host connection status

```ts
import { metaProvider } from '@novasamatech/product-sdk';

const unsubscribe = metaProvider.subscribeConnectionStatus((status) => {
  console.log('connection status changed', status);
});
```

### Chat Integration

```ts
import { createProductChatManager } from '@novasamatech/product-sdk';

// Create manager instance
const chat = createProductChatManager();

// Register your product as a chat contact
const roomRegistrationStatus = await chat.registerRoom({
  roomId: 'my-product-room',
  name: 'My Product',
  icon: 'https://example.com/icon.png'
});

// Register your product as a chat bot
const botRegistrationStatus = await chat.registerBot({
  botId: 'my-product-bot',
  name: 'My Product',
  icon: 'https://example.com/icon.png'
});

// Send a message
const { messageId } = await chat.sendMessage('my-product-room', {
  tag: 'Text',
  value: 'Hello dear user!'
});

// Subscribing to chat actions (incoming messages, etc.)
const subscriber = chat.subscribeAction((action) => {
  console.log('Room:', action.roomId);
  console.log('Sender:', action.peer);

  const payload = action.payload;

  if (payload.tag === 'MessagePosted') {
    console.log('Received message:', action.value);
  }
  if (payload.tag === 'ActionTriggered') {
    console.log('User triggered action:', action.value)
  }
});

// Subscribing to chat room list updates
const chatListSubscriber = chat.subscribeChatList((rooms) => {
  console.log('Chat rooms updated:', rooms);
});

// Sending a custom message
await chat.sendMessage('my-product-room', {
  tag: 'Custom',
  value: { messageType: 'my-custom-type', payload: new Uint8Array([/* ... */]) }
});

// Handling custom message rendering requests from host
const unsubscribeRenderer = chat.onCustomMessageRenderingRequest((messageType, payload, render) => {
  // Build a CustomRendererNode tree and pass it to render()
  render({
    tag: 'Text',
    value: {
      modifiers: undefined,
      props: { style: undefined, color: undefined },
      children: [{ tag: 'String', value: 'Custom message content' }],
    },
  });

  return () => {
    // cleanup when subscription ends
  };
});
```

**Note:** Messages sent before registration will be queued and sent automatically after successful registration.

### Statement Store

The Statement Store provides a decentralized way to store statements (messages).
It can be used for various purposes like p2p communication, storing temp data, etc.

```ts
import { createStatementStore } from '@novasamatech/product-sdk';
import type { Topic, Statement, SignedStatement } from '@novasamatech/product-sdk';

// Create statement store instance
const statementStore = createStatementStore();

// Define topics (32-byte identifiers) to categorize statements
const topic: Topic = new Uint8Array(32);

// Subscribe to statement updates for specific topics
const subscription = statementStore.subscribe([topic], (statements) => {
  console.log('Received statement updates:', statements);
});

// Create a proof for a new statement
const accountId = ['product.dot', 0]; // [DotNS identifier, derivation index]
const statement: Statement = {
  proof: undefined,
  decryptionKey: undefined,
  priority: undefined,
  channel: undefined,
  topics: [topic],
  data: new Uint8Array([/* your data */]),
};

const proof = await statementStore.createProof(accountId, statement);

// Submit a signed statement
const signedStatement: SignedStatement = {
  ...statement,
  proof,
};

await statementStore.submit(signedStatement);

// Unsubscribe when done
subscription.unsubscribe();
```

### Accounts Provider

The Accounts Provider allows you to access product accounts and create signers for signing transactions.

```ts
import { createAccountsProvider } from '@novasamatech/product-sdk';
import type { ProductAccount } from '@novasamatech/product-sdk';

// Create accounts provider instance
const accountsProvider = createAccountsProvider();

// Get a product account by DotNS identifier and derivation index
const accountResult = await accountsProvider.getProductAccount('product.dot', 0);

if (accountResult.isOk()) {
  const account: ProductAccount = accountResult.value;
  console.log('Public key:', account.publicKey);
}

// Get account alias
const aliasResult = await accountsProvider.getProductAccountAlias('product.dot', 0);

if (aliasResult.isOk()) {
  console.log('Alias:', aliasResult.value);
}

// Get legacy accounts (external wallets)
const legacyAccountsResult = await accountsProvider.getLegacyAccounts();

if (legacyAccountsResult.isOk()) {
  console.log('Legacy accounts:', legacyAccountsResult.value);
}

// Subscribe to account connection status changes
const unsubscribe = accountsProvider.subscribeAccountConnectionStatus((status) => {
  // status: 'connected' | 'disconnected'
  console.log('Account connection status:', status);
});

// Create a signer for a product account (for use with PAPI)
const account: ProductAccount = {
  dotNsIdentifier: 'product.dot',
  derivationIndex: 0,
  publicKey: new Uint8Array([/* ... */])
};
const signer = accountsProvider.getProductAccountSigner(account);

// Create a signer for a legacy account
const legacySigner = accountsProvider.getLegacyAccountSigner(account);

// PAPI transaction signing example

const productAccountSignedTx = await tx.signAndSubmit(signer);
const legacyAccountSignedTx = await tx.signAndSubmit(legacySigner);
```

### Local Storage

The Local Storage module provides a way to persist data in the host application's storage.

```ts
import { hostLocalStorage, createLocalStorage } from '@novasamatech/product-sdk';

// Use the default instance
const storage = hostLocalStorage;

// Or create a custom instance with a different transport
// const storage = createLocalStorage(customTransport);

// Write and read raw bytes
await storage.writeBytes('key', new Uint8Array([1, 2, 3]));
const bytes = await storage.readBytes('key');

// Write and read strings
await storage.writeString('greeting', 'Hello, World!');
const greeting = await storage.readString('greeting');

// Write and read JSON
await storage.writeJSON('config', { theme: 'dark', fontSize: 14 });
const config = await storage.readJSON('config');

// Clear a key
await storage.clear('key');
```

### Derive Entropy

The Derive Entropy function allows products to derive deterministic 32-byte entropy scoped to the product and a caller-chosen key.

```ts
import { deriveEntropy } from '@novasamatech/product-sdk';

const result = await deriveEntropy(new Uint8Array([1, 2, 3]));

if (result.isOk()) {
  const entropy: Uint8Array = result.value;
  console.log('Derived entropy:', entropy);
}
```

### Permissions

Products can request device and remote permissions from the host. Decisions are prompted once and persisted permanently — subsequent calls for the same permission resolve immediately without prompting.

```ts
import { requestDevicePermission, requestPermission } from '@novasamatech/product-sdk';

// Request a single device permission
const deviceResult = await requestDevicePermission('Camera');
if (deviceResult.isOk()) {
  console.log('Camera granted:', deviceResult.value); // boolean
}

// Request remote permissions in a batch (single user prompt for all)
const remoteResult = await requestPermission([
  { tag: 'Remote', value: ['api.coingecko.com', '*.example.com'] },
  { tag: 'ChainSubmit', value: undefined },
]);
if (remoteResult.isOk()) {
  console.log('All remote permissions granted:', remoteResult.value); // boolean
}
```

Available device permission values: `'Notifications'`, `'Camera'`, `'Microphone'`, `'Bluetooth'`, `'NFC'`, `'Location'`, `'Clipboard'`, `'OpenUrl'`, `'Biometrics'`.

Available remote permission tags: `'Remote'` (HTTP/WS domain patterns), `'WebRTC'`, `'ChainSubmit'`, `'PreimageSubmit'`, `'StatementSubmit'`.

> **Note:** `remote_chain_transaction_broadcast`, `remote_preimage_submit`, and `remote_statement_store_submit` implicitly trigger a permission prompt if the relevant permission has not yet been resolved. Call `requestPermission(...)` proactively before entering those flows for a controlled UX.

### Preimage Manager

The Preimage Manager allows you to lookup and submit preimages to the host application.

```ts
import { preimageManager, createPreimageManager } from '@novasamatech/product-sdk';

// Use the default instance
const manager = preimageManager;

// Or create a custom instance with a different transport
// const manager = createPreimageManager(customTransport);

// Lookup a preimage by its hash key
const subscription = manager.lookup('0x1234...', (preimage) => {
  if (preimage) {
    console.log('Preimage found:', preimage);
  } else {
    console.log('Preimage not found');
  }
});

// Unsubscribe when done
subscription.unsubscribe();

// Submit a preimage
const preimageKey = await manager.submit(new Uint8Array([1, 2, 3, 4]));
```

### Payment manager

```ts
import { createPaymentManager } from '@novasamatech/product-sdk';

const payments = createPaymentManager();

// Subscribe to the user's payment balance (host will prompt for consent)
const balanceSub = payments.subscribeBalance(balance => {
  console.log('Available:', balance.available);
  console.log('Pending:', balance.pending);
});
balanceSub.onInterrupt(() => console.log('Balance access denied or lost'));

// Top up the user's balance from a product account
await payments.topUp(1_000_000n, {
  type: 'productAccount',
  dotNsIdentifier: 'my-product.dot',
  derivationIndex: 0,
});

// Request a payment from the user (host shows confirmation UI)
const destination = new Uint8Array(32); // 32-byte AccountId
const receipt = await payments.requestPayment(500_000n, destination);

// Track payment settlement
const statusSub = payments.subscribePaymentStatus(receipt.id, status => {
  if (status.type === 'completed') console.log('Payment settled');
  if (status.type === 'failed') console.log('Payment failed:', status.reason);
});
```
