# @novasamatech/host-api-wrapper

An easy way to embed Polkadot host functionality into your dapp.

## Overview

Product SDK provides a set of tools to integrate your application with any Polkadot host application.
Core features:
- Generic injectWeb3 provider similar to [polkadot-js extension](https://polkadot.js.org/extension/)
- Chat module integration
- Product renderer for custom chat messages, Pocket cards and other product-drawn bodies
- Statement store integration
- Accounts provider for product accounts and signing
- Redirect [PAPI](https://papi.how/) requests to host application
- Receive additional information from host application - supported chains, theme, etc.
- Local storage for persisting data in the host application
- Preimage manager for looking up and submitting preimages
- Pocket cards and the host's contact picker

## Installation

```shell
npm install @novasamatech/host-api-wrapper --save -E
```

## Usage

### Injecting account provider into `injectedWeb3` interface

Product SDK can provide account information and signers with the same interface as any other Polkadot-compatible wallet.

```ts
import { injectSpektrExtension, SpektrExtensionName } from '@novasamatech/host-api-wrapper';
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
import { createPapiProvider, WellKnownChain } from '@novasamatech/host-api-wrapper';

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
import { metaProvider } from '@novasamatech/host-api-wrapper';

const unsubscribe = metaProvider.subscribeConnectionStatus((status) => {
  console.log('connection status changed', status);
});
```

### Subscriptions

Every streaming method returns a `Subscription`: call `unsubscribe()` to stop it, and `onInterrupt(callback)` to learn
when the host ends it. The callback receives the method's error — `GenericError` unless the method documents its own
(payments, coin payment) — or `undefined` when the host ended the stream cleanly. A transport-level failure (the host
denied or does not support the call, a malformed frame, …) is folded into that same error type, as for request methods.

```ts
import { createThemeProvider } from '@novasamatech/host-api-wrapper';

const subscription = createThemeProvider().subscribeTheme(theme => console.log(theme));

subscription.onInterrupt(reason => {
  if (reason === undefined) return; // ended cleanly
  console.error('theme stream failed:', reason.payload.reason);
});
```

### Chat Integration

```ts
import { createProductChatManager } from '@novasamatech/host-api-wrapper';

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
    // A press on a button the host drew for an `Actions` message. Actions inside
    // a product-rendered `Custom` message arrive through the product renderer.
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

```

A `Custom` message is drawn by the product itself — see [Product renderer](#product-renderer).

**Note:** Messages sent before registration will be queued and sent automatically after successful registration.

### Product renderer

A product draws parts of host surfaces — custom chat messages, Pocket card faces, input widget candidates — as
`RendererNode` trees the host renders from its own design system. The host starts a render for each body it shows
(`renderer.render`) with a `RenderContext` naming the body and the product-defined payload; the product streams trees
back for as long as the body is on screen. Actions inside a tree (button presses, text field changes) come back
scoped to the same context.

A product has **one** render handler; match on `request.context` to tell the surfaces apart.
[`@novasamatech/product-react-renderer`](../product-react-renderer) builds these handlers from React components.

```ts
import { matchChatMessageRenderers, productRenderer } from '@novasamatech/host-api-wrapper';

const unregister = productRenderer.onRender((request, render) => {
  const { context, payload, subscribeActions, end } = request;

  if (context.tag !== 'PocketCard') {
    // Ends the stream with an error: the host shows the product's identity and no body.
    end(`Unsupported surface ${context.tag}`);
    return () => {};
  }

  // Each tree replaces the previous one.
  render({
    tag: 'Button',
    value: {
      modifiers: [],
      props: { text: `Card ${context.value.cardId}`, variant: 'primary', enabled: undefined, loading: undefined, clickAction: 'open' },
      children: [],
    },
  });

  // Actions triggered inside this body only. `payload` is empty for a button
  // press and the UTF-8 bytes of the new value for a text field change.
  const unsubscribe = subscribeActions((actionId, actionPayload) => {
    console.log('action', actionId, actionPayload);
  });

  // Runs when the body leaves the screen, or after `end()`.
  return unsubscribe;
});

// Custom chat messages, dispatched by `messageType`. A message type missing
// from the map ends its stream with an error.
productRenderer.onRender(
  matchChatMessageRenderers({
    'my-custom-type': ({ roomId, messageId, messageType, payload, subscribeActions, end }, render) => {
      render({ tag: 'String', value: `${messageType} ${messageId} in ${roomId}` });
      return () => {};
    },
  }),
);

// Every action across all rendered bodies, each with the context it came from.
productRenderer.subscribeActions(({ context, actionId, payload }) => {
  console.log(context.tag, actionId, payload);
});
```

`end()` without a reason finishes the stream cleanly and leaves the last tree on screen. Registering another handler
replaces the previous one for requests that arrive afterwards; the function `onRender` returns unregisters it and ends
the bodies that are still open. Use `createProductRenderer(transport)` for a non-default transport, and
`isSameRenderContext(a, b)` to compare contexts yourself.

### Statement Store

The Statement Store provides a decentralized way to store statements (messages).
It can be used for various purposes like p2p communication, storing temp data, etc.

```ts
import { createStatementStore } from '@novasamatech/host-api-wrapper';
import type {
  Topic,
  Statement,
  SignedStatement,
  StatementTopicFilter,
  ProductAccountRef,
} from '@novasamatech/host-api-wrapper';

// Create statement store instance
const statementStore = createStatementStore();

// Define topics (32-byte identifiers) to categorize statements
const topic: Topic = new Uint8Array(32);

// Subscribe to statements matching ALL listed topics (AND semantics)
const filter: StatementTopicFilter = { matchAll: [topic] };
const subscription = statementStore.subscribe(filter, (page) => {
  // page.isComplete is true once the initial historical dump is done
  console.log('Received statements:', page.statements, 'synced:', page.isComplete);
});

// Create a proof for a new statement
// [DotNS identifier, account selector]. The selector is a plain index or a raw
// 32-byte index (RFC 0022).
const accountId: ProductAccountRef = ['product.dot', 0];
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
import { accounts, hostContacts } from '@novasamatech/host-api-wrapper';
import type { ProductAccount, ProofContext } from '@novasamatech/host-api-wrapper';

// Get the user's primary DotNS username (RFC-0014)
// — prompts for permission on first call
const userIdResult = await accounts.getUserId();

if (userIdResult.isOk()) {
  const { primaryUsername } = userIdResult.value;
  console.log('Primary username:', primaryUsername);
} else {
  const err = userIdResult.error;
  if (err.tag === 'NotConnected') {
    console.log('User is not logged in');
  } else if (err.tag === 'PermissionDenied') {
    console.log('User denied disclosure of their primary username');
  }
}

// Request login — triggers host sign-in UI; reason is shown to the user
const loginResult = await accounts.requestLogin('Sign in to access your account');

if (loginResult.isOk()) {
  const outcome = loginResult.value; // 'success' | 'alreadyConnected' | 'rejected'
  if (outcome === 'rejected') {
    console.log('User cancelled login');
  }
} else {
  console.error('Login error:', loginResult.error);
}

// Get a product account by DotNS identifier and account selector. The selector
// is a plain index (the primary, enumerable form) or a raw 32-byte index
// (RFC 0022); it defaults to index 0, the product's default account.
const accountResult = await accounts.getProductAccount('product.dot', 0);
// …or, for a byte-valued selector:
// const accountResult = await accounts.getProductAccount('product.dot', raw32);

if (accountResult.isOk()) {
  const account: ProductAccount = accountResult.value;
  console.log('Public key:', account.publicKey);
}

// Ring VRF: a contextual alias and a proof are addressed by an explicit member
// key handle, a product-scoped `context` (`[productId, suffix]`) and a `ring`
// location on a chain (RFC 0004, amended by RFC 0024). The suffix is the same
// selector as an account's derivation index and expands to the same 32-byte
// value (RFC 0022).
const context: ProofContext = ['product.dot', 0]; // [productId, selector]
const ring = {
  chainId: '0x…', // 32-byte chain genesis hash
  junctions: [{ tag: 'PalletInstance', value: 42 }],
};

// Register a key your own product owns for that ring. Permissionless and
// prompt-free — ownership is the calling product, never a parameter. Returns the
// member public key. Registering the same index for another ring extends the
// existing entry rather than adding a second one.
const registerResult = await accounts.registerRingVrfKey(0, ring);

// Discover another product's keys. Handles are opaque: select by the rings an
// entry declares, NEVER by index — the index is the owner's implementation
// detail and hardcoding it breaks the moment the owner rotates or adds a key.
const keysResult = await accounts.listRingVrfKeys('peopl.dot'); // 'Anonymized' by default
const personKey = keysResult.isOk()
  ? keysResult.value.find(entry => entry.rings.some(r => r.chainId === ring.chainId))
  : undefined;

// A key handle for one of your own keys — for a foreign key use the handle from
// `listRingVrfKeys` verbatim instead.
import { ringVrfKeyHandle } from '@novasamatech/host-api-wrapper';

const ownHandle = ringVrfKeyHandle('product.dot', 0);

// Get the contextual alias for that (handle, context, ring).
const aliasResult = await accounts.getContextualAlias(ownHandle, context, ring);

if (aliasResult.isOk()) {
  const { context: contextBytes, alias } = aliasResult.value;
  console.log('Alias:', alias);
}

// Create a ring VRF proof binding `message` with an explicit member key.
// A proof is a bearer token for its context's alias, so a *foreign* handle is
// admitted only when its owner allowlisted your product in its manifest — there
// is no user-prompt fallback, and you get `NotAllowlisted` otherwise.
const proofResult = await accounts.createRingVRFProof(ownHandle, context, ring, new Uint8Array([0x48, 0x69]));

if (proofResult.isOk()) {
  const { proof, contextualAlias, ringIndex, ringRevision } = proofResult.value;
  console.log('Proof:', proof, 'at ring index', ringIndex, 'revision', ringRevision);
}

// Sign with the member key itself rather than proving membership anonymously
// (RFC 0024). No context and no ring: it derives no alias and proves nothing, so
// there is nothing for either to scope. Verified against the member public key,
// which makes the signature linkable to every other use of that key.
const signatureResult = await accounts.ringVrfSign(ownHandle, new Uint8Array([0x48, 0x69]));

// sr25519 VRF signature over a product account (RFC-0023). The transcript is a
// recipe — a root label plus ordered `(label, value)` items — that the host
// replays verbatim (`Transcript::new(label)` then one `append_message` per item)
// and signs. It never injects a `signer` item; pass the account's public key
// yourself if the transcript needs one.
import type { VrfTranscriptItem } from '@novasamatech/host-api-wrapper';

const transcriptLabel = new TextEncoder().encode('my-product-lottery');
const items: VrfTranscriptItem[] = [{ label: new TextEncoder().encode('round'), value: new Uint8Array([7]) }];

const vrfResult = await accounts.signVrf('product.dot', 0, transcriptLabel, items);

if (vrfResult.isOk()) {
  const { preOutput, proof } = vrfResult.value; // 32-byte VRFPreOut, 64-byte VRFProof
  console.log('VRF pre-output:', preOutput, 'proof:', proof);
} else {
  // err.tag: 'NotConnected' | 'Rejected' | 'Unknown'
  console.error('signVrf failed:', vrfResult.error.tag);
}

// Sign raw data WITHOUT the `<Bytes>` watermark — a temporary compatibility API
// for runtime ownership proofs, deprecated on arrival. A Uint8Array is signed as
// bytes, a string goes through the host's `Payload` decoding. Requires signing
// authorization and an explicit user confirmation.
if (accountResult.isOk()) {
  const signed = await accounts.signRawUnwatermarkedDeprecated(accountResult.value, new Uint8Array([0x48, 0x69]));
  // …and for a legacy account: accounts.signRawUnwatermarkedDeprecatedWithLegacyAccount(legacyAccount, bytes)
}

// Get legacy accounts (external wallets)
const legacyAccountsResult = await accounts.getLegacyAccounts();

if (legacyAccountsResult.isOk()) {
  console.log('Legacy accounts:', legacyAccountsResult.value);
}

// Subscribe to account connection status changes
const unsubscribe = accounts.subscribeAccountConnectionStatus((status) => {
  // status: 'connected' | 'disconnected'
  console.log('Account connection status:', status);
});

// Create a signer for a product account (for use with PAPI).
// Resolve the account first, then hand it to the signer factory.
const productAccountResult = await accounts.getProductAccount('product.dot', 0);

if (productAccountResult.isOk()) {
  const productSigner = accounts.getProductAccountSigner(productAccountResult.value);
  const signedTx = await tx.signAndSubmit(productSigner);
}

// Pay a contact the user picked (see "Contacts"): put the handle bytes where the
// recipient account goes in the call, and list the handle in `contacts`. The
// host replaces it with the contact's account before anything is shown or
// signed, and rejects with `CreateTransactionErr.UnknownContact` otherwise.
const picked = await hostContacts.pick();

if (picked.type === 'picked' && productAccountResult.isOk()) {
  const signer = accounts.getProductAccountSigner(productAccountResult.value, 'createTransaction', {
    contacts: [picked.handle],
  });
  // `AccountId` from polkadot-api: the handle's 32 bytes stand in for the recipient.
  const dest = MultiAddress.Id(AccountId().dec(picked.handle.bytes));
  const transfer = api.tx.Balances.transfer_keep_alive({ dest, value: 1n });
  await transfer.signAndSubmit(signer);
}

// Create a signer for a legacy account.
// Fetch the legacy account list, pick one, then pass it to the signer factory.
const legacyAccountsResult = await accounts.getLegacyAccounts();

if (legacyAccountsResult.isOk()) {
  const [legacyAccount] = legacyAccountsResult.value;
  if (legacyAccount) {
    const legacySigner = accounts.getLegacyAccountSigner(legacyAccount);
    const signedTx = await tx.signAndSubmit(legacySigner);
  }
}
```

> If you need a non-default transport (e.g. for tests or multi-host setups), use `createAccountsProvider(transport)` to build your own instance with the same API.

### Local Storage

The Local Storage module provides a way to persist data in the host application's storage.

```ts
import { hostLocalStorage, createLocalStorage } from '@novasamatech/host-api-wrapper';

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

// Read another product's storage. Succeeds only when that product's manifest
// grants yours the `storage` scope; rejects with `StorageReadV2Err.AccessNotGranted`
// otherwise — for an unknown product as well.
const shared = await storage.readJSON('config', 'other-product.dot');

// Subscribe to a key. The callback fires with the current value right away,
// then on every later write or clear. `undefined` means the key is absent.
const sub = storage.subscribeBytes('key', (bytes) => {
  console.log('key changed:', bytes);
});
storage.subscribeString('greeting', (text) => console.log(text));
storage.subscribeJSON('config', (value) => console.log(value));

// Stop receiving updates
sub.unsubscribe();
```

### Derive Entropy

The Derive Entropy function allows products to derive deterministic 32-byte entropy scoped to the product and a caller-chosen key.

```ts
import { deriveEntropy } from '@novasamatech/host-api-wrapper';

const result = await deriveEntropy(new Uint8Array([1, 2, 3]));

if (result.isOk()) {
  const entropy: Uint8Array = result.value;
  console.log('Derived entropy:', entropy);
}
```

### Permissions

Products can request device and remote permissions from the host. Decisions are prompted once and persisted permanently — subsequent calls for the same permission resolve immediately without prompting.

```ts
import { requestDevicePermission, requestPermission } from '@novasamatech/host-api-wrapper';

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

> **Note:** `chain.broadcastTransaction`, `preimage.submit`, and `statementStore.submit` implicitly trigger a permission prompt if the relevant permission has not yet been resolved. Call `requestPermission(...)` proactively before entering those flows for a controlled UX.

### Preimage Manager

The Preimage Manager allows you to lookup and submit preimages to the host application.

```ts
import { preimageManager, createPreimageManager } from '@novasamatech/host-api-wrapper';

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
import { createPaymentManager } from '@novasamatech/host-api-wrapper';

const payments = createPaymentManager();

// Subscribe to the user's payment balance (host will prompt for consent)
const balanceSub = payments.subscribeBalance(balance => {
  console.log('Available:', balance.available);
  console.log('Pending:', balance.pending);
});
balanceSub.onInterrupt(() => console.log('Balance access denied or lost'));

// Top up the user's balance from one of the calling product's accounts.
// `derivationIndex` is the same selector as `accounts.getProductAccount` takes:
// a plain index or a raw 32-byte index (RFC 0022).
//
// The last argument is a product-chosen, opaque 32-byte id. It makes the call
// idempotent — a retry with the same id rejects with
// `PaymentTopUpErr.AlreadyExists` instead of starting a second top up — and it
// is the handle the status subscription is opened on. Persist it before
// calling, so a product that dies mid-flight can pick the outcome back up: the
// host drives a registered top up to a terminal status on its own, across a
// full host restart, and keeps that status indefinitely.
const topUpId = crypto.getRandomValues(new Uint8Array(32));

// Resolves once the host has registered the top up, not when the funds land.
// Rejects with `PaymentTopUpErr.SourceBusy` if the source still carries a top up
// that has not reached a terminal status — one live top up per source.
await payments.topUp(1_000_000n, { type: 'productAccount', derivationIndex: 0 }, topUpId);

// Track the outcome. `claimed` with `finalized: true`, `claimedPartially` and
// `notClaimed` are terminal — nothing is sent, and nothing is done, after them.
const topUpSub = payments.subscribeTopUpStatus(topUpId, status => {
  switch (status.type) {
    case 'detecting':
      return console.log('Waiting for the funds to appear on the source');
    case 'claiming':
      return console.log('Claim in progress');
    case 'claimed':
      return console.log(status.finalized ? 'Claimed and finalized' : 'Claimed at best head');
    case 'claimedPartially':
      // The source never held enough to cover the request — send it the
      // remainder and register a new top up.
      return console.log('Only claimed', status.actualClaimed);
    case 'notClaimed':
      // The host never observed any balance at the source.
      return console.log('Nothing could be claimed');
  }
});
topUpSub.onInterrupt(reason => console.log('Top up status lost:', reason));

// Request a payment from the user's balance to a destination account (host
// shows confirmation UI). Like `topUp`, the product supplies an opaque 32-byte
// id: a retry with the same id rejects with `PaymentRequestErr.AlreadyExists`
// instead of paying twice, and the id is the handle the status subscription is
// opened on. Persist it before calling — the host drives a registered payment to
// a terminal status on its own, across a full host restart, and keeps that
// status indefinitely.
const destination = new Uint8Array(32); // 32-byte AccountId
const paymentId = crypto.getRandomValues(new Uint8Array(32));

// Resolves once the host has registered the payment, not when it settles.
await payments.requestPayment(500_000n, destination, paymentId);

// Track settlement. `completed`, `failed` and `partiallyClaimed` are terminal.
const statusSub = payments.subscribePaymentStatus(paymentId, status => {
  switch (status.type) {
    case 'processing':
      return console.log('Payment in progress');
    case 'completed':
      return console.log('Payment settled');
    case 'failed':
      return console.log('Payment failed:', status.reason);
    case 'partiallyClaimed':
      // Only part of the amount reached the destination.
      return console.log('Only delivered', status.actualClaimed);
  }
});
statusSub.onInterrupt(reason => console.log('Payment status lost:', reason));
```

### Coin payment (RFC 0017)

Firewalled purses, cheques, and receivables. The long-running operations
(rebalance, delete, deposit, refund, listen) stream clearing status through a
callback and return a `Subscription`; `onInterrupt` fires with a
`CoinPaymentErr` if the host tears the stream down (`Internal` for a transport
failure), or with `undefined` when it ends cleanly.

```ts
import { createCoinPayment } from '@novasamatech/host-api-wrapper';

const coinPayment = createCoinPayment();

// Create a purse and read it back
const purse = await coinPayment.createPurse('Terminal purse');
const info = await coinPayment.queryPurse(purse);
console.log('balance:', info.balance);

// Pay a receivable with a cheque
const receivable = await coinPayment.createReceivable(purse);
const cheque = await coinPayment.createCheque(purse, receivable, 1000);

// Claim the cheque, watching the coins clear
const sub = coinPayment.deposit(cheque, status => {
  if (status.tag === 'Done') console.log('cleared:', status.value.cleared);
  if (status.tag === 'Failed') console.log('failed:', status.value.error);
});
sub.onInterrupt(err => console.log('deposit interrupted:', err));

// Wait for a cheque delivered over a standard channel
coinPayment.listenForPayment(receivable, item => {
  if (item.tag === 'Cheque') console.log('received cheque:', item.value.amount);
});
```

### Pocket

A product's cards in the host's Pocket collection. Card faces are drawn through the
[product renderer](#product-renderer) with a `PocketCard` render context.

```ts
import { hostPocket, createPocket } from '@novasamatech/host-api-wrapper';

// Emits the whole card set right away, then again after every change.
const cardsSub = hostPocket.subscribeCards(cards => {
  for (const { cardId, privileged } of cards) {
    console.log(cardId, privileged ? '(placed by the host)' : '');
  }
});

// Removing a card that is not present resolves; a privileged card rejects with
// `PocketRemoveCardErr.Privileged`.
await hostPocket.removeCard('ticket-42');
```

### Contacts

Opens the host's contact picker. The product never reads the contact list — it gets only an opaque handle for the
person the user chose, so there is no permission to request. The handle is not an address: it resolves to an account
only inside a `createTransaction` that lists it in `contacts` (see [Accounts Provider](#accounts-provider)).

```ts
import { hostContacts } from '@novasamatech/host-api-wrapper';

const outcome = await hostContacts.pick();

switch (outcome.type) {
  case 'picked':
    console.log('handle:', outcome.handle.bytes); // 32 bytes, stable per person
    break;
  case 'dismissed':
    // the user closed the picker — worth offering again
    break;
  case 'noContacts':
    // nobody to pick — no picker was shown
    break;
}
```
