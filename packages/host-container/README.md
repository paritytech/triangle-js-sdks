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

The container is nested the way the wire addresses methods: one group per protocol trait, one slot per method, named
after the method (the method names of the truapi specification):

```ts
container.<trait>.handle<Method>(handler) // => VoidFunction, restores the default handler
```

Every product-initiated method has a slot, except `system.handshake` (the transport answers it) and the `chain`
methods other than `getChainInfo` (all served by [`handleChainConnection`](#handlechainconnection)). Host-initiated
subscriptions go the other way: the host subscribes and the product serves, see
[`renderer.render`](#rendererrender).

| Trait                | Slots                                                                                                                                                                                                                                                                  |
|----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `system`             | `handleFeatureSupported`, `handleNavigateTo`, `handleInfo`, `handleGetProductContext`                                                                                                                                                                                  |
| `account`            | `handleConnectionStatusSubscribe`, `handleGetAccount`, `handleGetAccountAlias`, `handleCreateAccountProof`, `handleGetLegacyAccounts`, `handleGetUserId`, `handleRequestLogin`, `handleSignVrf`, `handleRegisterRingVrfKey`, `handleListRingVrfKeys`, `handleRingVrfSign` |
| `chain`              | `handleGetChainInfo`                                                                                                                                                                                                                                                   |
| `chat`               | `handleCreateRoom`, `handleRegisterBot`, `handleListSubscribe`, `handlePostMessage`, `handleActionSubscribe`                                                                                                                                                           |
| `coinPayment`        | `handleCreatePurse`, `handleQueryPurse`, `handleRebalancePurse`, `handleDeletePurse`, `handleCreateReceivable`, `handleCreateCheque`, `handleDeposit`, `handleRefund`, `handleListenForPayment`                                                                        |
| `entropy`            | `handleDerive`                                                                                                                                                                                                                                                         |
| `localStorage`       | `handleRead`, `handleWrite`, `handleClear`, `handleSubscribe`                                                                                                                                                                                                          |
| `notifications`      | `handleSendPushNotification`, `handleCancelPushNotification`                                                                                                                                                                                                           |
| `payment`            | `handleBalanceSubscribe`, `handleTopUp`, `handleRequest`, `handleStatusSubscribe`, `handleTopUpStatusSubscribe`                                                                                                                                                        |
| `permissions`        | `handleRequestDevicePermission`, `handleRequestRemotePermission`, `handleAuthorizeRemotePermission`, `handleAuthorizeDevicePermission`                                                                                                                                 |
| `preimage`           | `handleLookupSubscribe`, `handleSubmit`                                                                                                                                                                                                                                |
| `resourceAllocation` | `handleRequest`                                                                                                                                                                                                                                                        |
| `signing`            | `handleCreateTransaction`, `handleCreateTransactionWithLegacyAccount`, `handleSignRawWithLegacyAccount`, `handleSignPayloadWithLegacyAccount`, `handleSignRaw`, `handleSignPayload`, `handleSignRawUnwatermarkedDeprecated`, `handleSignRawUnwatermarkedDeprecatedWithLegacyAccount` |
| `statementStore`     | `handleSubscribe`, `handleCreateProof`, `handleSubmit`, `handleCreateProofAuthorized`                                                                                                                                                                                  |
| `theme`              | `handleSubscribe`                                                                                                                                                                                                                                                      |
| `locale`             | `handleSubscribe`                                                                                                                                                                                                                                                      |
| `renderer`           | `render`, `handleActionSubscribe`                                                                                                                                                                                                                                      |
| `pocket`             | `handleListSubscribe`, `handleRemoveCard`                                                                                                                                                                                                                              |
| `worker`             | `handleBeginOperation`, `handleEndOperation`                                                                                                                                                                                                                           |
| `contacts`           | `handlePick`                                                                                                                                                                                                                                                           |

A request handler receives the request's params and `{ ok, err, signal }`, and returns a `ResultAsync`. `signal` is
aborted when the product withdraws the call; the product has already been answered `Cancelled` by then, so whatever the
handler resolves with afterwards is dropped.

A subscription handler receives `(params, send, interrupt)` and returns its cleanup. `interrupt(undefined)` completes
the subscription cleanly; any other value ends it with that error.

Until a handler is registered (or after its cleanup ran), a request answers the transport-level `Unsupported` failure
and a subscription is interrupted with it — except the `payment` and `coinPayment` subscriptions, which interrupt with
their own domain error. `host-api-wrapper` folds `Unsupported` into the method's own error type.

### system.handleFeatureSupported

```ts
container.system.handleFeatureSupported((params, { ok, err }) => {
  if (params.tag === 'Chat') {
    return ok(supportedChains.has(params.value));
  }
  return ok(false);
});
```

### permissions.handleRequestDevicePermission

The `request` parameter is one of: `'Notifications'`, `'Camera'`, `'Microphone'`, `'Bluetooth'`, `'NFC'`, `'Location'`, `'Clipboard'`, `'OpenUrl'`, `'Biometrics'`.

```ts
container.permissions.handleRequestDevicePermission(async (request, { ok, err }) => {
  // request is a string literal: 'Notifications' | 'Camera' | 'Microphone' | ...
  const granted = await promptDevicePermission(request);
  return ok(granted);
});
```

### permissions.handleRequestRemotePermission

The `request` parameter is a single `RemotePermission` item. Return `ok(true)` when the permission is granted, `ok(false)` when denied.

The item has one of these shapes:
- `{ tag: 'Remote', value: string[] }` — HTTP/WS domain patterns (exact or `*.wildcard`)
- `{ tag: 'WebRtc', value: undefined }` — WebRTC access (may expose user IP)
- `{ tag: 'ChainSubmit', value: undefined }` — broadcast transactions via `chain.broadcastTransaction`
- `{ tag: 'PreimageSubmit', value: undefined }` — submit preimages via `preimage.submit`
- `{ tag: 'StatementSubmit', value: undefined }` — submit statements via `statementStore.submit`

```ts
container.permissions.handleRequestRemotePermission(async (permission, { ok, err }) => {
  switch (permission.tag) {
    case 'Remote':
      return ok(await checkDomainPermissions(permission.value));
    case 'WebRtc':
      return ok(await promptWebRTCPermission());
    case 'ChainSubmit':
      return ok(await promptChainSubmitPermission());
    case 'PreimageSubmit':
      return ok(await promptPreimageSubmitPermission());
    case 'StatementSubmit':
      return ok(await promptStatementSubmitPermission());
  }
});
```

`chain.broadcastTransaction`, `preimage.submit` and `statementStore.submit` are gated by the matching permission: the
container consults this handler before invoking theirs, and answers a denial with the method's own error. A gated
method with no handler registered answers `Unsupported` without asking for the permission.

### permissions.handleAuthorizeRemotePermission / permissions.handleAuthorizeDevicePermission

Host-internal methods, not exposed to products: the host's own product-side code (for example a sandbox mediating
`fetch`, WebSocket or media capture) authorizes **one** operation, consuming an available one-use grant. They take the
same params and answer the same `bool` as the `request*` methods. The gated slots above never consult them.

```ts
container.permissions.handleAuthorizeRemotePermission(async (permission, { ok }) => {
  return ok(await grants.consume(productId, permission));
});

container.permissions.handleAuthorizeDevicePermission(async (permission, { ok }) => {
  // permission: 'Camera' | 'Microphone' | ...
  return ok(await grants.consume(productId, permission));
});
```

### notifications.handleSendPushNotification

Gated by the `Notifications` device permission: the container consults `permissions.handleRequestDevicePermission` with `'Notifications'` before invoking this handler. If the device permission is denied or errors, the handler is skipped and the request fails. `notifications.handleCancelPushNotification` is gated the same way.

```ts
container.notifications.handleSendPushNotification(async (notification, { ok, err }) => {
  await showNotification(notification);
  return ok(undefined);
});
```

### system.handleNavigateTo

```ts
container.system.handleNavigateTo(async (url, { ok, err }) => {
  await navigate(url);
  return ok(undefined);
});
```

### entropy.handleDerive

```ts
container.entropy.handleDerive(async (key, { ok, err }) => {
  const entropy = await deriveEntropy(key);
  return ok(entropy);
});
```

### localStorage.handleRead

The handler works in the latest (v2) shape: `{ product, key }`, where `product` names the product whose storage is read
(`undefined`, or the caller's own id, reads the caller's own). Answer `StorageReadV2Err.AccessNotGranted` for every
refusal — unknown product, no manifest, no `storage` grant — so the call cannot probe which products exist.

A v1 request (a bare key) reaches the handler as `{ product: undefined, key }`, and its answer is downgraded to v1:
`AccessNotGranted` becomes `StorageErr.Unknown` (a v1 caller cannot address foreign storage, so it never provokes one).

```ts
import { StorageReadV2Err } from '@novasamatech/host-api';

container.localStorage.handleRead(async ({ product, key }, { ok, err }) => {
  const owner = product ?? productId;
  if (owner !== productId && !(await grantsStorageRead(owner, productId))) {
    return err(new StorageReadV2Err.AccessNotGranted());
  }
  return ok(await storage.get(owner, key)); // `undefined` for an absent key
});
```

### localStorage.handleWrite

```ts
container.localStorage.handleWrite(async ([key, value], { ok, err }) => {
  try {
    await storage.set(key, value);
    return ok(undefined);
  } catch (e) {
    return err({ tag: 'Full' });
  }
});
```

### localStorage.handleClear

```ts
container.localStorage.handleClear(async (key, { ok, err }) => {
  await storage.delete(key);
  return ok(undefined);
});
```

### account.handleConnectionStatusSubscribe

```ts
container.account.handleConnectionStatusSubscribe((_, send, interrupt) => {
  const listener = (status) => send(status);
  accountService.on('connectionStatusChange', listener);
  return () => accountService.off('connectionStatusChange', listener);
});
```

### theme.handleSubscribe

```ts
container.theme.handleSubscribe((_, send, interrupt) => {
  const listener = (theme: 'light' | 'dark') => send(theme);
  themeService.on('change', listener);
  send(themeService.getCurrentTheme());
  return () => themeService.off('change', listener);
});
```

### account.handleGetUserId

Called when a product requests the user's primary DotNS username (RFC-0014). Show a disclosure prompt on first call; the host decides what counts as "primary" for the calling product. Return `NotConnected` without prompting if no user is connected; return `PermissionDenied` if the user denies disclosure.

```ts
import { GetUserIdErr } from '@novasamatech/host-api';

container.account.handleGetUserId(async (_, { ok, err }) => {
  const username = await pickPrimaryUsernameForCallingProduct();
  if (!username) {
    return err(new GetUserIdErr.NotConnected());
  }

  const granted = await promptUserForUsernameDisclosure();
  if (!granted) {
    return err(new GetUserIdErr.PermissionDenied());
  }

  return ok({ primaryUsername: username });
});
```

### account.handleRequestLogin

Called when a product requests the host login UI. Present the sign-in flow and return the outcome. `reason` is an optional human-readable string the product provides to explain why login is needed.

```ts
import { LoginErr } from '@novasamatech/host-api';

container.account.handleRequestLogin(async (reason, { ok, err }) => {
  const alreadyConnected = await checkIfConnected();
  if (alreadyConnected) return ok('alreadyConnected');

  const result = await presentLoginUI(reason);
  if (!result.success) return ok('rejected');

  return ok('success');
});
```

### account.handleGetAccount

The derivation index is an `Enum` (RFC 0022): `Index`
carries a plain index, `Raw` a raw 32-byte index. Expand it with
[`derivationIndexBytes`](#derivation-index-helpers) — past this boundary only
the 32-byte form exists.

```ts
import { derivationIndexBytes } from '@novasamatech/host-container';

container.account.handleGetAccount(async ([dotnsId, derivationIndex], { ok, err }) => {
  // `//product//{dotnsId}/{index}` — hard, hard, soft junctions.
  const account = await getProductAccount(dotnsId, derivationIndexBytes(derivationIndex));
  if (account) {
    return ok({ publicKey: account.publicKey });
  }
  return err({ tag: 'NotConnected' });
});
```

### account.handleRegisterRingVrfKey

A product registers a ring VRF key it owns against the ring it intends it for
(RFC-0024). Ownership is the calling product id and is never a parameter, so this
needs no capability gate and no prompt. Registration is idempotent — registering
an already-registered `index` for an additional `ring` extends that entry rather
than creating a second one — and it declares *intent*, not membership, so it must
never be treated as a personhood oracle.

Registration always reaches the Account Holder, which is the authoritative
registry, but need not block on it: with the product's ring VRF domain entropy
the host can answer immediately and mirror the registration fire-and-forget.

> A host MUST NOT derive a member secret for a `(product, index)` pair absent
> from its registry. Domain entropy makes derivation unconditional arithmetic —
> only registration brings a key into existence.

```ts
container.account.handleRegisterRingVrfKey(async ([index, ring], { ok, err }) => {
  if (!isConnected()) {
    return err(new RegisterRingVrfKeyErr.NotConnected());
  }
  if (!(await isKnownRing(ring))) {
    return err(new RegisterRingVrfKeyErr.RingNotFound());
  }
  // `productId` comes from the container's own context — never from the caller.
  return ok(await registry.register(productId, index, ring));
});
```

On a successful registration, match `ring` against the well-known ring table
(People, People-Lite) by structural equality and record the handle as the
corresponding person key — that is what replaces a compiled-in key selection for
the host's own personhood-dependent features. If two products register for the
same well-known ring, do **not** pick silently: resolve to the product the user
designated as their personhood provider (defaulting to the first registrar), so a
second product cannot displace the first.

### account.handleListRingVrfKeys

Answer from the registry snapshot when it is current. Listing the caller's own
keys is permissionless; a foreign `owner` needs a grant or a prompt, and
`'PublicKey'` disclosure is separately permissioned because a member public key
is linkable across every ring it appears in. Omit `publicKey` under
`'Anonymized'`.

```ts
container.account.handleListRingVrfKeys(async ([owner, disclosure], { ok, err }) => {
  if (owner !== productId && !(await hasGrantFor(productId, owner))) {
    return err(new ListRingVrfKeysErr.Rejected());
  }
  const entries = await registry.list(owner);
  return ok(
    entries.map(entry => ({
      handle: entry.handle,
      rings: entry.rings,
      publicKey: disclosure === 'PublicKey' ? entry.publicKey : undefined,
    })),
  );
});
```

### account.handleGetAccountAlias

`keyHandle` names the ring VRF key explicitly (RFC-0024) — the host no longer
defines a PoP collection, infers correspondence, or falls back to a compiled-in
key. `context` is `[productId, suffix]`, where `suffix` is the same selector as
an account's derivation index and expands to the same 32-byte value (RFC 0022),
so the alias ↔ account mapping is the identity on it.

`ring` stays a separate argument because a key may be registered for several;
verify it appears among the handle's declared rings and return `KeyNotInRing`
otherwise, and `KeyNotRegistered` when the handle has no entry at all.

```ts
container.account.handleGetAccountAlias(async ([keyHandle, context, ring], { ok, err }) => {
  const entry = await registry.lookup(keyHandle);
  if (!entry) {
    return err(new GetAliasErr.KeyNotRegistered());
  }
  if (!entry.rings.some(declared => sameRing(declared, ring))) {
    return err(new GetAliasErr.KeyNotInRing());
  }
  const alias = await getContextualAlias(entry, context, ring);
  if (alias) {
    return ok({ context: alias.context, alias: alias.alias });
  }
  return err(new GetAliasErr.RingNotFound());
});
```

Reading an alias authorizes nothing, so a foreign `keyHandle` here is governed by
the ordinary grant-or-prompt model — unlike `account.handleCreateAccountProof` below.

### account.handleCreateAccountProof

Same handle checks as `account.handleGetAccountAlias`, plus the allowlist gate. A proof is
a **bearer token for its context's alias**, and `message` is opaque — for an
extrinsic it is a hash of the inherited implication — so nothing at call time can
tell what the result will authorize. A host MUST therefore reject a foreign
`keyHandle` unless the key's owning product allowlisted the caller in its
manifest, and MUST NOT offer a user prompt as a fallback: consenting to an opaque
message is not meaningful consent, and only the key's owner is positioned to
evaluate the risk.

```ts
container.account.handleCreateAccountProof(async ([keyHandle, context, ring, message], { ok, err }) => {
  const [owner] = keyHandle;
  const entry = await registry.lookup(keyHandle);
  if (!entry) {
    return err(new CreateProofErr.KeyNotRegistered());
  }
  // The owner's manifest allowlist is the ONLY authorization here — no prompt.
  if (owner !== productId && !(await ownerAllowlists(owner, productId))) {
    return err(new CreateProofErr.NotAllowlisted());
  }
  if (!entry.rings.some(declared => sameRing(declared, ring))) {
    return err(new CreateProofErr.KeyNotInRing());
  }
  if (!(await isMemberOfRing(entry, ring))) {
    return err(new CreateProofErr.NotMember());
  }
  const { proof, contextualAlias, ringIndex, ringRevision } = await createRingProof(entry, context, ring, message);
  return ok({ proof, contextualAlias, ringIndex, ringRevision });
});
```

### account.handleRingVrfSign

Signs with the member key itself instead of producing an anonymous ring proof
(RFC-0024). It carries no context and no ring, so there is nothing to scope what
the signature is good for — it is the wider version of the bearer-token problem
above, gated by the same allowlist with the same no-prompt rule. The result is
verified against the member public key and is linkable to every other use of that
key.

```ts
container.account.handleRingVrfSign(async ([keyHandle, message], { ok, err }) => {
  if (!isConnected()) {
    return err(new RingVrfSignErr.NotConnected());
  }
  const [owner] = keyHandle;
  if (!(await registry.lookup(keyHandle))) {
    return err(new RingVrfSignErr.KeyNotRegistered());
  }
  if (owner !== productId && !(await ownerAllowlists(owner, productId))) {
    return err(new RingVrfSignErr.NotAllowlisted());
  }
  return ok(await signWithMemberKey(keyHandle, message));
});
```

### account.handleSignVrf

Produces an sr25519 (schnorrkel) VRF signature over a transcript the product supplies as a
recipe (RFC-0023). Replay it verbatim — no interpretation of labels or values — so one
method serves any consuming runtime. Authorize it exactly like `signing.handleSignRaw`: reject with
`NotConnected` when there is no session (never auto-prompt login), sign locally when
`AutoSigning` covers the account, otherwise ask the user and return `Rejected` on decline.
Bound `items.length` and the total transcript size against a hostile caller.

```ts
container.account.handleSignVrf(async ({ account, transcriptLabel, items }, { ok, err }) => {
  if (!isConnected()) {
    return err(new SignVrfErr.NotConnected());
  }
  if (!(await confirmVrfSigning(account))) {
    return err(new SignVrfErr.Rejected());
  }

  const transcript = newTranscript(transcriptLabel);
  for (const item of items) {
    transcript.appendMessage(item.label, item.value);
  }
  const { preOutput, proof } = await vrfSign(account, transcript);

  return ok({ preOutput, proof });
});
```

### account.handleGetLegacyAccounts

```ts
container.account.handleGetLegacyAccounts(async (_, { ok, err }) => {
  const accounts = await getLegacyAccounts();
  return ok(accounts);
});
```

### signing.handleCreateTransaction

```ts
container.signing.handleCreateTransaction(async ([productAccountId, payload], { ok, err }) => {
  try {
    const signedTx = await createTransaction(productAccountId, payload);
    return ok(signedTx);
  } catch (e) {
    return err({ tag: 'Rejected' });
  }
});
```

### signing.handleCreateTransactionWithLegacyAccount

```ts
container.signing.handleCreateTransactionWithLegacyAccount(async (payload, { ok, err }) => {
  try {
    const signedTx = await createTransactionWithLegacyAccount(payload);
    return ok(signedTx);
  } catch (e) {
    return err({ tag: 'Rejected' });
  }
});
```

### signing.handleSignRaw

```ts
container.signing.handleSignRaw(async (payload, { ok, err }) => {
  try {
    const result = await signRaw(payload);
    return ok({ signature: result.signature, signedTransaction: result.signedTransaction });
  } catch (e) {
    return err({ tag: 'Rejected' });
  }
});
```

### signing.handleSignPayload

```ts
container.signing.handleSignPayload(async (payload, { ok, err }) => {
  try {
    const result = await signPayload(payload);
    return ok({ signature: result.signature, signedTransaction: result.signedTransaction });
  } catch (e) {
    return err({ tag: 'Rejected' });
  }
});
```

### signing.handleSignRawUnwatermarkedDeprecated / signing.handleSignRawUnwatermarkedDeprecatedWithLegacyAccount

Sign raw bytes **without** the `<Bytes>…</Bytes>` watermark. Deprecated on arrival: only for integrations that cannot
verify watermarked signatures. Same params, result and errors as `signing.handleSignRaw` /
`signing.handleSignRawWithLegacyAccount`; authorize them the same way, and make the user aware the bytes are signed
as-is (they may be a valid extrinsic or any other signed message).

```ts
container.signing.handleSignRawUnwatermarkedDeprecated(async (payload, { ok, err }) => {
  if (!(await confirmUnwatermarkedSigning(payload))) {
    return err({ tag: 'Rejected' });
  }
  return ok(await signRawBytes(payload));
});
```

### chat.handleCreateRoom

```ts
container.chat.handleCreateRoom(async (room, { ok, err }) => {
  await chatService.registerRoom(room);
  return ok(undefined);
});
```

### chat.handleRegisterBot

```ts
container.chat.handleRegisterBot(async (bot, { ok, err }) => {
  await chatService.registerBot(bot);
  return ok(undefined);
});
```

### chat.handleListSubscribe

```ts
container.chat.handleListSubscribe((_, send, interrupt) => {
  const listener = (rooms) => send(rooms);
  chatService.on('roomsUpdate', listener);
  return () => chatService.off('roomsUpdate', listener);
});
```

### chat.handlePostMessage

```ts
container.chat.handlePostMessage(async (message, { ok, err }) => {
  const messageId = await chatService.postMessage(message);
  return ok({ messageId });
});
```

### chat.handleActionSubscribe

```ts
container.chat.handleActionSubscribe((_, send, interrupt) => {
  const listener = (action) => send(action);
  chatService.on('action', listener);
  return () => chatService.off('action', listener);
});
```

### renderer.render

Host-initiated: the host asks the product to draw a body and the product streams `RendererNode` trees back until either
side ends it. `context` says where the body lives (`ChatMessage`, `InputWidget` or `PocketCard`); `payload` is
product-defined and opaque to the host.

```ts
const subscription = container.renderer.render(
  {
    context: { tag: 'ChatMessage', value: { roomId, messageId, messageType: 'my-custom-type' } },
    payload,
  },
  node => {
    // node is a RendererNode tree describing the UI to render
    console.log('Render:', node);
  },
);

subscription.onInterrupt(reason => {
  // `undefined` when the product completed cleanly
});

// Unsubscribe when done
subscription.unsubscribe();
```

### renderer.handleActionSubscribe

Actions triggered inside product-rendered bodies: `actionId` names the action as the renderer tree declared it,
`payload` is empty for a `Button` press and the UTF-8 bytes of the new value for a `TextField` change.

```ts
container.renderer.handleActionSubscribe((_, send, interrupt) => {
  const listener = ({ context, actionId, payload }) => send({ context, actionId, payload });
  rendererHost.on('action', listener);
  return () => rendererHost.off('action', listener);
});
```

### statementStore.handleSubscribe

```ts
container.statementStore.handleSubscribe((filter, send, interrupt) => {
  // filter is { tag: 'MatchAll', value: Uint8Array[] } | { tag: 'MatchAny', value: Uint8Array[] }
  const listener = (page) => send(page);
  statementStore.subscribe(filter, listener);
  return () => statementStore.unsubscribe(filter, listener);
});
```

### statementStore.handleCreateProof

```ts
container.statementStore.handleCreateProof(async ([[dotnsId, derivationIndex], statement], { ok, err }) => {
  try {
    const proof = await createStatementProof(dotnsId, derivationIndexBytes(derivationIndex), statement);
    return ok(proof);
  } catch (e) {
    return err({ tag: 'UnableToSign' });
  }
});
```

### statementStore.handleSubmit

```ts
container.statementStore.handleSubmit(async (statement, { ok, err }) => {
  try {
    await statementStore.submit(statement);
    return ok(undefined);
  } catch (e) {
    return err({ tag: 'Unknown', value: { reason: e.message } });
  }
});
```

### preimage.handleLookupSubscribe

```ts
container.preimage.handleLookupSubscribe((key, send, interrupt) => {
  const listener = (value) => send(value);
  preimageService.subscribe(key, listener);
  return () => preimageService.unsubscribe(key, listener);
});
```

### preimage.handleSubmit

```ts
container.preimage.handleSubmit(async (preimage, { ok, err }) => {
  try {
    const key = await preimageService.submit(preimage);
    return ok(key);
  } catch (e) {
    return err({ tag: 'Unknown', value: { reason: e.message } });
  }
});
```

### payment.handleBalanceSubscribe

Called when a product subscribes to balance updates. Host should prompt for user consent on the first call; interrupt the subscription to communicate denial.

```ts
container.payment.handleBalanceSubscribe((_params, send, interrupt) => {
  const unsubscribe = balanceService.subscribe(balance => {
    send({ available: balance.available, pending: balance.pending });
  });

  return () => unsubscribe();
});
```

### payment.handleTopUp

Called when a product requests a balance top-up from a product-controlled source. Does not require user consent.

The handler MUST return as soon as the top up is registered — it does not wait for the funds. `id` is an opaque 32-byte
`Uint8Array` chosen by the product and is the idempotency key: answer `AlreadyExists` if a top up is already registered
under it. A source can carry only one live top up at a time — answer `SourceBusy` while its previous top up has not
reached a terminal status. The outcome is reported through `payment.handleTopUpStatusSubscribe`, keyed on the same id.

Once the host accepts a top up it owns it: it MUST drive the operation to a terminal status, surviving a full host
restart, and it MUST keep that status readable indefinitely.

```ts
container.payment.handleTopUp(async ({ amount, source, id }, { ok, err }) => {
  // `id` is a raw 32-byte Uint8Array, so key storage by its hex form.
  const key = toHex(id);
  if (topUps.has(key)) return err(new PaymentTopUpErr.AlreadyExists());
  if (topUps.hasLiveFor(source)) return err(new PaymentTopUpErr.SourceBusy());

  if (source.tag === 'ProductAccount') {
    // Account of the calling product, addressed by the RFC-0022 selector.
    topUps.register(key, { amount, from: derivationIndexBytes(source.value) });
    return ok(undefined);
  }
  if (source.tag === 'PrivateKey') {
    topUps.register(key, { amount, key: source.value });
    return ok(undefined);
  }
  return err(new PaymentTopUpErr.InvalidSource());
});
```

### payment.handleTopUpStatusSubscribe

Called when a product subscribes to the outcome of a top up it registered. Interrupt with `PaymentTopUpStatusErr.NotFound`
when the id is unknown.

`Claimed { finalized: true }`, `ClaimedPartially` and `NotClaimed` are terminal — send nothing after them, and take no
further action on the operation. A partial claim is reported here, not as a `payment.handleTopUp` error; it is also what
an `amount` below the smallest coinage denomination produces, the host claiming `amount - amount % 2^min_coinage_exponent`.

```ts
container.payment.handleTopUpStatusSubscribe((id, send, interrupt) => {
  const topUp = topUps.get(toHex(id));
  if (!topUp) {
    interrupt(new PaymentTopUpStatusErr.NotFound());
    return () => {};
  }

  return topUp.track(status => {
    if (status === 'detecting') send({ tag: 'Detecting', value: undefined });
    if (status === 'claiming') send({ tag: 'Claiming', value: undefined });
    if (status === 'claimed') send({ tag: 'Claimed', value: { finalized: status.finalized } });
    if (status === 'partial') send({ tag: 'ClaimedPartially', value: { actualClaimed: status.claimed } });
    if (status === 'failed') send({ tag: 'NotClaimed', value: undefined });
  });
});
```

### payment.handleRequest

Called when a product requests a payment from the user's balance to a destination account. Host MUST show a
confirmation UI.

The handler MUST return as soon as the payment is registered — it does not wait for settlement. `id` is an opaque
32-byte `Uint8Array` chosen by the product and is the idempotency key: answer `AlreadyExists` if a payment is already
registered under it. The outcome is reported through `payment.handleStatusSubscribe`, keyed on the same id.

Once the host accepts a payment it owns it: it MUST drive the operation to a terminal status, surviving a full host
restart, and it MUST keep that status readable indefinitely.

```ts
container.payment.handleRequest(async ({ amount, destination, id }, { ok, err }) => {
  // `id` is a raw 32-byte Uint8Array, so key storage by its hex form.
  const key = toHex(id);
  if (payments.has(key)) return err(new PaymentRequestErr.AlreadyExists());

  const approved = await showPaymentConfirmation({ amount, destination });
  if (!approved) return err(new PaymentRequestErr.Rejected());

  payments.register(key, { amount, destination });
  return ok(undefined);
});
```

### payment.handleStatusSubscribe

Called when a product subscribes to the outcome of a payment it registered. Interrupt with
`PaymentStatusErr.PaymentNotFound` when the id is unknown.

`Completed`, `Failed` and `PartiallyClaimed` are terminal — send nothing after them, and take no further action on the
operation. `PartiallyClaimed` carries the amount that actually reached the destination, less than requested.

```ts
container.payment.handleStatusSubscribe((id, send, interrupt) => {
  const payment = payments.get(toHex(id));
  if (!payment) {
    interrupt(new PaymentStatusErr.PaymentNotFound());
    return () => {};
  }

  return payment.track(status => {
    if (status === 'processing') send({ tag: 'Processing', value: undefined });
    if (status === 'completed') send({ tag: 'Completed', value: undefined });
    if (status === 'partial') send({ tag: 'PartiallyClaimed', value: status.delivered });
    if (status === 'failed') send({ tag: 'Failed', value: 'settlement failed' });
  });
});
```

### pocket.handleListSubscribe

Sends the calling product's whole card set on subscribe and again after every change. `privileged` cards were placed by
the host itself and can be removed by neither the user nor the product.

```ts
container.pocket.handleListSubscribe((_, send, interrupt) => {
  const listener = (cards) => send({ cards: cards.map(({ cardId, privileged }) => ({ cardId, privileged })) });
  pocket.on('change', listener);
  send({ cards: pocket.list(productId) });
  return () => pocket.off('change', listener);
});
```

### pocket.handleRemoveCard

Removing a card that is not present succeeds.

```ts
import { PocketRemoveCardErr } from '@novasamatech/host-api';

container.pocket.handleRemoveCard(async ({ cardId }, { ok, err }) => {
  if (pocket.isPrivileged(productId, cardId)) {
    return err(new PocketRemoveCardErr.Privileged());
  }
  await pocket.remove(productId, cardId);
  return ok(undefined);
});
```

### contacts.handlePick

Lets the user pick a contact. The answer is an opaque, product-scoped 32-byte handle — it names the contact to the host
(e.g. as a `signing.createTransaction` recipient) without disclosing who the contact is.

```ts
import { ContactsPickErr } from '@novasamatech/host-api';

container.contacts.handlePick(async (_, { ok, err, signal }) => {
  if (!isConnected()) {
    return err(new ContactsPickErr.NotConnected());
  }
  const contact = await showContactPicker({ signal });
  if (!contact) {
    return ok({ outcome: { tag: 'Dismissed', value: undefined } });
  }
  return ok({ outcome: { tag: 'Picked', value: { handle: { bytes: contactHandleFor(productId, contact) } } } });
});
```

### handleChainConnection

```ts
import { getWsProvider } from 'polkadot-api/ws-provider';

const chains = new Map([
  ['0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3', 'wss://rpc.polkadot.io'],
  ['0xb0a8d493285c2df73290dfb7e61f870f17b41801197a149ca93654499ea3dafe', 'wss://kusama-rpc.polkadot.io'],
]);

const disconnect = container.handleChainConnection(genesisHash => {
  const endpoint = chains.get(genesisHash);
  if (!endpoint) return null;
  return getWsProvider(endpoint);
});
```

Serves every `chain` method except `getChainInfo` (`container.chain.handleGetChainInfo`) from JSON-RPC providers:
`followHeadSubscribe`, `getHeadHeader`, `getHeadBody`, `getHeadStorage`, `callHead`, `unpinHead`, `continueHead`,
`stopHeadOperation`, `getSpecGenesisHash`, `getSpecChainName`, `getSpecProperties`, `broadcastTransaction` (gated by the
`ChainSubmit` remote permission) and `stopTransaction`. Before it is called, and after `disconnect()`, they answer
`Unsupported`.

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

## Derivation index helpers

Product accounts live at `//product//{productId}/{index}` (RFC 0022): two hard
junctions and a soft one whose chain code is a **32-byte** derivation index. The
wire selector — `ProductAccountId`'s index, `ProductProofContext`'s suffix, the
`ProductAccount` top-up source and `SmartContractAllowance` — carries either a
plain `u32` or those 32 bytes directly; these helpers expand it.

```ts
import { INDEX_MAGIC, derivationIndexBytes, indexBytes } from '@novasamatech/host-container';

// blake2b256("product-account-index")[..28] — keeps the plain-index space and
// the raw-index space disjoint.
INDEX_MAGIC;

// u32 little-endian ++ INDEX_MAGIC. A product's default account is index 0.
indexBytes(0);

// Wire selector → the 32 bytes used as the soft junction's chain code.
derivationIndexBytes({ tag: 'Index', value: 5 }); // === indexBytes(5)
derivationIndexBytes({ tag: 'Raw', value: raw32 }); // === raw32
```

Note that stock tooling (`polkadot-js`, `subkey`) cannot express this path: the
32-byte index is not a typeable path segment, so `//product//browse.dot/5` there
does **not** derive index `5`.

## Known pitfalls

### CSP error on iframe loading
If a dapp is hosted on a different domain than the container and uses HTTPS, you should add this meta tag to your host application HTML:

```html
<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">
```
