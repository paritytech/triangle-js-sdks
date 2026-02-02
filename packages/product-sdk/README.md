# @novasamatech/product-sdk

An easy way to embed Polkadot host functionality into your dapp.

## Overview

Product SDK provides a set of tools to integrate your application with any Polkadot host application.
Core features:
- Generic injectWeb3 provider similar to [polkadot-js extension](https://polkadot.js.org/extension/)
- Chat module integration
- Statement store integration
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

### Subscribing connection status

```ts
import { metaProvider } from '@novasamatech/product-sdk';

const unsubscribe = metaProvider.subscribeConnectionStatus((status) => {
  console.log('connection status changed', status);
});
```

### Chat Integration

```ts
import { createChat } from '@novasamatech/product-sdk';

// Create chat instance
const chat = createChat();

// Register your dapp as a chat contact
const registrationStatus = await chat.register({
  name: 'My Product',
  icon: 'https://example.com/icon.png'
});

// Send a message
const { messageId } = await chat.sendMessage({
  tag: 'Text',
  value: 'Hello dear user!'
});

// Subscribe to chat actions (incoming messages, etc.)
const subscriber = chat.subscribeAction((action) => {
  if (action.tag === 'MessagePosted') {
    console.log('Received message:', action.value);
  }
  if (action.tag === 'ActionTriggered') {
    console.log('User triggered action:', action.value)
  }
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

