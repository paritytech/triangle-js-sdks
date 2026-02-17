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

#### iframe

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

#### webview

```ts
import { createContainer, createWebviewProvider } from '@novasamatech/host-container';

const webview = document.createElement('webview');

const provider = createWebviewProvider({
  webview,
  openDevTools: false,
});
const container = createContainer(provider);

document.body.appendChild(webview);
```

## API reference

### handleFeatureSupported

```ts
container.handleFeatureSupported((params, { ok, err }) => {
  if (params.tag === 'Chat') {
    return ok(supportedChains.has(params.value));
  }
  return ok(false);
});
```

### handleDevicePermission

```ts
container.handleDevicePermission(async (request, { ok, err }) => {
  const granted = await requestDevicePermission(request);
  return ok(granted);
});
```

### handlePermission

```ts
container.handlePermission(async (request, { ok, err }) => {
  if (request.tag === 'ExternalRequest') {
    const allowed = await checkExternalRequestPermission(request.value);
    return ok(allowed);
  }
  if (request.tag === 'TransactionSubmit') {
    return ok(true);
  }
  return ok(false);
});
```

### handlePushNotification

```ts
container.handlePushNotification(async (notification, { ok, err }) => {
  await showNotification(notification);
  return ok(undefined);
});
```

### handleNavigateTo

```ts
container.handleNavigateTo(async (url, { ok, err }) => {
  await navigate(url);
  return ok(undefined);
});
```

### handleLocalStorageRead

```ts
container.handleLocalStorageRead(async (key, { ok, err }) => {
  const value = await storage.get(key);
  return ok(value ?? null);
});
```

### handleLocalStorageWrite

```ts
container.handleLocalStorageWrite(async ([key, value], { ok, err }) => {
  try {
    await storage.set(key, value);
    return ok(undefined);
  } catch (e) {
    return err({ tag: 'Full' });
  }
});
```

### handleLocalStorageClear

```ts
container.handleLocalStorageClear(async (key, { ok, err }) => {
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

### handleChatCreateRoom

```ts
container.handleChatCreateRoom(async (room, { ok, err }) => {
  await chatService.registerRoom(room);
  return ok(undefined);
});
```

### handleChatBotRegistration

```ts
container.handleChatBotRegistration(async (bot, { ok, err }) => {
  await chatService.registerBot(bot);
  return ok(undefined);
});
```

### handleChatListSubscribe

```ts
container.handleChatListSubscribe((_, send, interrupt) => {
  const listener = (rooms) => send(rooms);
  chatService.on('roomsUpdate', listener);
  return () => chatService.off('roomsUpdate', listener);
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

### handleStatementStoreSubscribe

```ts
container.handleStatementStoreSubscribe((query, send, interrupt) => {
  const listener = (statements) => send(statements);
  statementStore.subscribe(query, listener);
  return () => statementStore.unsubscribe(query, listener);
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

### handleStatementStoreSubmit

```ts
container.handleStatementStoreSubmit(async (statement, { ok, err }) => {
  try {
    await statementStore.submit(statement);
    return ok(undefined);
  } catch (e) {
    return err({ tag: 'Unknown', value: { reason: e.message } });
  }
});
```

### handlePreimageLookupSubscribe

```ts
container.handlePreimageLookupSubscribe((key, send, interrupt) => {
  const listener = (value) => send(value);
  preimageService.subscribe(key, listener);
  return () => preimageService.unsubscribe(key, listener);
});
```

### handlePreimageSubmit

```ts
container.handlePreimageSubmit(async (preimage, { ok, err }) => {
  try {
    const key = await preimageService.submit(preimage);
    return ok(key);
  } catch (e) {
    return err({ tag: 'Unknown', value: { reason: e.message } });
  }
});
```

### handleChainConnection

```ts
import { getWsProvider } from 'polkadot-api/ws-provider';

const chains = new Map([
  ['0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3', 'wss://rpc.polkadot.io'],
  ['0xb0a8d493285c2df73290dfb7e61f870f17b41801197a149ca93654499ea3dafe', 'wss://kusama-rpc.polkadot.io'],
]);

container.handleChainConnection((genesisHash) => {
  const endpoint = chains.get(genesisHash);
  if (!endpoint) return null;
  return getWsProvider(endpoint);
});
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

### subscribeProductConnectionStatus

```ts
const unsubscribe = container.subscribeProductConnectionStatus((status) => {
  console.log('Connection status:', status);
});
```

## Known pitfalls

### CSP error on iframe loading
If a dapp is hosted on a different domain than the container and uses HTTPS, you should add this meta tag to your host application HTML:

```html
<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">
```
