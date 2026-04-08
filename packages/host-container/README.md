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

The `request` parameter is one of: `'Notifications'`, `'Camera'`, `'Microphone'`, `'Bluetooth'`, `'NFC'`, `'Location'`, `'Clipboard'`, `'OpenUrl'`, `'Biometrics'`.

```ts
container.handleDevicePermission(async (request, { ok, err }) => {
  // request is a string literal: 'Notifications' | 'Camera' | 'Microphone' | ...
  const granted = await promptDevicePermission(request);
  return ok(granted);
});
```

### handlePermission

The `request` parameter is an **array** of `RemotePermission` items. Return `ok(true)` only when **all** permissions in the batch are granted.

Each item has one of these shapes:
- `{ tag: 'Remote', value: string[] }` — HTTP/WS domain patterns (exact or `*.wildcard`)
- `{ tag: 'WebRTC', value: undefined }` — WebRTC access (may expose user IP)
- `{ tag: 'ChainSubmit', value: undefined }` — broadcast transactions via `remote_chain_transaction_broadcast`
- `{ tag: 'PreimageSubmit', value: undefined }` — submit preimages via `remote_preimage_submit`
- `{ tag: 'StatementSubmit', value: undefined }` — submit statements via `remote_statement_store_submit`

```ts
container.handlePermission(async (permissions, { ok, err }) => {
  for (const permission of permissions) {
    if (permission.tag === 'Remote') {
      const allowed = await checkDomainPermissions(permission.value);
      if (!allowed) return ok(false);
    } else if (permission.tag === 'WebRTC') {
      const allowed = await promptWebRTCPermission();
      if (!allowed) return ok(false);
    } else if (permission.tag === 'ChainSubmit') {
      const allowed = await promptChainSubmitPermission();
      if (!allowed) return ok(false);
    } else if (permission.tag === 'PreimageSubmit') {
      const allowed = await promptPreimageSubmitPermission();
      if (!allowed) return ok(false);
    } else if (permission.tag === 'StatementSubmit') {
      const allowed = await promptStatementSubmitPermission();
      if (!allowed) return ok(false);
    }
  }
  return ok(true);
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

### handleDeriveEntropy

```ts
container.handleDeriveEntropy(async (key, { ok, err }) => {
  const entropy = await deriveEntropy(key);
  return ok(entropy);
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

### handleAccountConnectionStatusSubscribe

```ts
container.handleAccountConnectionStatusSubscribe((_, send, interrupt) => {
  const listener = (status) => send(status);
  accountService.on('connectionStatusChange', listener);
  return () => accountService.off('connectionStatusChange', listener);
});
```

### handleThemeSubscribe

```ts
container.handleThemeSubscribe((_, send, interrupt) => {
  const listener = (theme: 'light' | 'dark') => send(theme);
  themeService.on('change', listener);
  send(themeService.getCurrentTheme());
  return () => themeService.off('change', listener);
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

### renderChatCustomMessage

```ts
const subscription = container.renderChatCustomMessage('my-custom-type', payload, (node) => {
  // node is a CustomRendererNode tree describing the UI to render
  console.log('Render custom message:', node);
});

// Unsubscribe when done
subscription.unsubscribe();
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

### handlePaymentBalanceSubscribe

Called when a product subscribes to balance updates. Host should prompt for user consent on the first call; interrupt the subscription to communicate denial.

```ts
container.handlePaymentBalanceSubscribe((_params, send, interrupt) => {
  const unsubscribe = balanceService.subscribe(balance => {
    send({ available: balance.available, pending: balance.pending });
  });

  return () => unsubscribe();
});
```

### handlePaymentTopUp

Called when a product requests a balance top-up from a product-controlled source. Does not require user consent.

```ts
container.handlePaymentTopUp(async ({ amount, source }, { ok, err }) => {
  if (source.tag === 'ProductAccount') {
    const [dotNsIdentifier, derivationIndex] = source.value;
    await transferFromProductAccount(dotNsIdentifier, derivationIndex, amount);
    return ok(undefined);
  }
  if (source.tag === 'PrivateKey') {
    await transferFromPrivateKey(source.value, amount);
    return ok(undefined);
  }
  return err(new PaymentTopUpErr.InvalidSource());
});
```

### handlePaymentRequest

Called when a product requests a payment from the user's balance. Host MUST show a confirmation UI. Returns a receipt immediately; settlement is asynchronous.

```ts
container.handlePaymentRequest(async ({ amount, destination }, { ok, err }) => {
  const approved = await showPaymentConfirmation({ amount, destination });
  if (!approved) return err(new PaymentRequestErr.Denied());

  const paymentId = await paymentService.submit(amount, destination);
  return ok({ id: paymentId });
});
```

### handlePaymentStatusSubscribe

Called when a product subscribes to the status of a previously requested payment.

```ts
container.handlePaymentStatusSubscribe((paymentId, send, interrupt) => {
  const unsubscribe = paymentService.trackStatus(paymentId, status => {
    if (status === 'processing') send({ tag: 'Processing', value: undefined });
    if (status === 'completed') send({ tag: 'Completed', value: undefined });
    if (status === 'failed') send({ tag: 'Failed', value: 'settlement failed' });
  });

  return () => unsubscribe();
});
```

### handleChainConnection

```ts
import { getWsProvider } from 'polkadot-api/ws-provider';

const chains = new Map([
  ['0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3', 'wss://rpc.polkadot.io'],
  ['0xb0a8d493285c2df73290dfb7e61f870f17b41801197a149ca93654499ea3dafe', 'wss://kusama-rpc.polkadot.io'],
]);

container.handleChainConnection({
  factory(genesisHash) {
    const endpoint = chains.get(genesisHash);
    if (!endpoint) return null;
    return getWsProvider(endpoint);
  }
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
