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

// Query existing statements by topics
const statements: SignedStatement[] = await statementStore.query([topic]);

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

// Get non-product accounts (external wallets)
const nonProductAccountsResult = await accountsProvider.getNonProductAccounts();

if (nonProductAccountsResult.isOk()) {
  console.log('Non-product accounts:', nonProductAccountsResult.value);
}

// Create a signer for a product account (for use with PAPI)
const account: ProductAccount = {
  dotNsIdentifier: 'product.dot',
  derivationIndex: 0,
  publicKey: new Uint8Array([/* ... */])
};
const signer = accountsProvider.getProductAccountSigner(account);

// Create a signer for a non-product account
const nonProductSigner = accountsProvider.getNonProductAccountSigner(account);

// PAPI transaction signing example

const productAccountSignedTx = await tx.signAndSubmit(signer);
const nonProductAccountSignedTx = await tx.signAndSubmit(nonProductSigner);
```

