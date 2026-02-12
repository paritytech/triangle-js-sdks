# @novasamatech/host-container

A robust solution for hosting and managing decentralized applications (dapps) within the Polkadot ecosystem.

## Overview

Host container provides the infrastructure layer for securely embedding and communicating with third-party dapps.
It handles the isolation boundary, message routing, lifecycle management, and security concerns inherent in hosting untrusted web content.

## Installation

```shell
npm install @novasamatech/host-container --save -E
```

### Basic Container Setup

```ts
import { createContainer, createIframeProvider } from '@novasamatech/host-container';

const iframe = document.createElement('iframe');

const provider = createIframeProvider({
  iframe,
  url: 'https://dapp.example.com'
});
const container = createContainer(provider);

document.body.appendChild(iframe);
```

## API reference

### handleFeature

```ts
container.handleFeature((params, { ok, err }) => {
  if (params.tag === 'Chat') {
    return ok(supportedChains.has(params.value));
  }
  return ok(false);
});
```

### handlePermissionRequest

```ts
container.handlePermissionRequest(async (params, { ok, err }) => {
  if (params.tag === 'ChainConnect') {
    // Show permission dialog to user
    const approved = await showPermissionDialog(params.value);
    return approved ? ok(undefined) : err({ tag: 'Rejected' });
  }
  return err({ tag: 'Unknown', value: { reason: 'Unsupported permission type' } });
});
```

### handleStorageRead

```ts
container.handleStorageRead(async (key, { ok, err }) => {
  const value = await storage.get(key);
  return ok(value ?? null);
});
```

### handleStorageWrite

```ts
container.handleStorageWrite(async ([key, value], { ok, err }) => {
  try {
    await storage.set(key, value);
    return ok(undefined);
  } catch (e) {
    return err({ tag: 'Full' });
  }
});
```

### handleStorageClear

```ts
container.handleStorageClear(async (key, { ok, err }) => {
  await storage.delete(key);
  return ok(undefined);
});
```

### handleAccountGet

```ts
container.handleAccountGet(async ([dotnsId, derivationIndex], { ok, err }) => {
  const account = await getProductAccount(dotnsId, derivationIndex);
  if (account) {
    return ok({ publicKey: account.publicKey, name: account.name ?? null });
  }
  return err({ tag: 'NotConnected' });
});
```

### handleAccountGetAlias

```ts
container.handleAccountGetAlias(async ([dotnsId, derivationIndex], { ok, err }) => {
  const alias = await getAccountAlias(dotnsId, derivationIndex);
  if (alias) {
    return ok({ context: alias.context, alias: alias.alias });
  }
  return err(new RequestCredentialsErr.NotConnected());
});
```

### handleAccountCreateProof

```ts
container.handleAccountCreateProof(async ([[dotnsId, derivationIndex], ringLocation, message], { ok, err }) => {
  try {
    const proof = await createRingProof(dotnsId, derivationIndex, ringLocation, message);
    return ok(proof);
  } catch (e) {
    return err({ tag: 'RingNotFound' });
  }
});
```

### handleGetNonProductAccounts

```ts
container.handleGetNonProductAccounts(async (_, { ok, err }) => {
  const accounts = await getNonProductAccounts();
  return ok(accounts);
});
```

### handleCreateTransaction

```ts
container.handleCreateTransaction(async ([productAccountId, payload], { ok, err }) => {
  try {
    const signedTx = await createTransaction(productAccountId, payload);
    return ok(signedTx);
  } catch (e) {
    return err({ tag: 'Rejected' });
  }
});
```

### handleCreateTransactionWithNonProductAccount

```ts
container.handleCreateTransactionWithNonProductAccount(async (payload, { ok, err }) => {
  try {
    const signedTx = await createTransactionWithNonProductAccount(payload);
    return ok(signedTx);
  } catch (e) {
    return err({ tag: 'Rejected' });
  }
});
```

### handleSignRaw

```ts
container.handleSignRaw(async (payload, { ok, err }) => {
  try {
    const result = await signRaw(payload);
    return ok({ signature: result.signature, signedTransaction: result.signedTransaction });
  } catch (e) {
    return err({ tag: 'Rejected' });
  }
});
```

### handleSignPayload

```ts
container.handleSignPayload(async (payload, { ok, err }) => {
  try {
    const result = await signPayload(payload);
    return ok({ signature: result.signature, signedTransaction: result.signedTransaction ?? null });
  } catch (e) {
    return err({ tag: 'Rejected' });
  }
});
```

### handleChatCreateContact

```ts
container.handleChatCreateContact(async (contact, { ok, err }) => {
  await chatService.registerContact(contact);
  return ok(undefined);
});
```

### handleChatPostMessage

```ts
container.handleChatPostMessage(async (message, { ok, err }) => {
  const messageId = await chatService.postMessage(message);
  return ok({ messageId });
});
```

### handleChatActionSubscribe

```ts
container.handleChatActionSubscribe((_, send, interrupt) => {
  const listener = (action) => send(action);
  chatService.on('action', listener);
  return () => chatService.off('action', listener);
});
```

### handleStatementStoreCreateProof

```ts
container.handleStatementStoreCreateProof(async ([[dotnsId, derivationIndex], statement], { ok, err }) => {
  try {
    const proof = await createStatementProof(dotnsId, derivationIndex, statement);
    return ok(proof);
  } catch (e) {
    return err({ tag: 'UnableToSign' });
  }
});
```

### handleJsonRpcMessageSubscribe

```ts
import { getWsProvider } from 'polkadot-api/ws-provider';

const provider = getWsProvider('wss://rpc.polkadot.io');
container.handleJsonRpcMessageSubscribe(
  { genesisHash: '0x...' },
  provider
);
```

### isReady

```ts
const ready = await container.isReady();
if (ready) {
  console.log('Container is ready');
}
```

### dispose

```ts
container.dispose();
```

### subscribeConnectionStatus

```ts
const unsubscribe = container.subscribeConnectionStatus((status) => {
  console.log('Connection status:', status);
});
```

## PAPI provider support

Host container supports [PAPI](https://papi.how/) request redirection from product to host container.
It can be useful to deduplicate socket connections or light client instances between multiple dapps.

To support this feature, you should add two additional handlers to the container:

### Chain support check
```ts
const genesisHash = '0x...';

container.handleFeature(async (feature) => {
  return feature.tag === 'Chain' && feature.value === genesisHash;
});
```

### Provider implementation

```ts
import { getWsProvider } from 'polkadot-api/ws-provider';

const genesisHash = '0x...';
const provider = getWsProvider('wss://...');

container.connectToPapiProvider(genesisHash, provider);
```

## Known pitfalls

### CSP error on iframe loading
If a dapp is hosted on a different domain than the container and uses HTTPS, you should add this meta tag to your host application HTML:

```html
<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">
```
