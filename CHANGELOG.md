## 0.7.6 (2026-05-06)

### 🚀 Features

- **host-worker-sandbox:** sandbox code can now use `Blob`, `FormData`, `AbortController` / `AbortSignal` (spec-compliant, including `reason`, `throwIfAborted`, `onabort`, and the `abort` / `timeout` / `any` statics), and `DOMException`.
- **host-worker-sandbox:** `fetch` (with `Headers`, `Request`, `Response`) is available when the host passes a `fetchResolver` to `createSandbox`. The host decides how requests are made; sandbox `AbortSignal`s propagate to the resolver.
- **host-worker-sandbox:** `crypto.subtle` is available when the host passes a `subtleResolver`. Resolver args are typed per method, so handlers get full inference without casts.
- **host-api / host-container / host-papp:** products can now request resource allocations from the host (RFC-0010) — statement-store allowances, bulletin allowances, smart-contract allowances per derivation index, and auto-signing. The host forwards the request to the paired Polkadot Mobile app, which approves or rejects each resource individually; the product receives a per-resource outcome (`Allocated`, `Rejected`, or `NotAvailable`). Exposed as `requestResourceAllocation` on the host-api side and `handleRequestResourceAllocation` on the container side.
- **host-api / host-container:** new `statementStoreCreateProofAuthorized` request lets a product create a statement-store proof against a host-managed allowance slot, without having to nominate a product account. Handled via the new `handleStatementStoreCreateProofAuthorized` slot on the container.
- **host-papp:** SSO `signPayload` / `signRaw` accept a product account ID (`[dotNsIdentifier, derivationIndex]`) directly, so callers can route a signing request to a specific product account without resolving its SS58 address first.

### 🩹 Fixes

- **host-worker-sandbox:** `crypto.getRandomValues` is now spec-compliant — returns the same array passed in, preserves the view type (e.g. `Uint32Array`), and only fills the bytes the view covers (previously could clobber adjacent bytes of the underlying buffer).
- **statement-store:** key derivation now matches Substrate's standard derivation rules, so keys derived from the same path agree with other Polkadot tooling. Paths that previously produced incompatible or unusable keys (numeric segments, long segments) now derive correctly.

### ⚠️ Breaking Changes

- **host-papp:** SSO `signPayload` / `signRaw` now identify the signing account by product account ID (`[dotNsIdentifier, derivationIndex]`) instead of an SS58 address. Callers no longer need to know or convert the remote account's address to ask the paired Polkadot Mobile app to sign — they pick the product account directly.

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat
- valentunn @valentunn

## 0.7.5 (2026-05-01)

### 🚀 Features

- **scale:** `instanceof` now works against an `ErrEnum` itself in addition to its variants — `err instanceof MyErrors` narrows to the union of all variant errors.

### 🩹 Fixes

- **host-container:** chain operations no longer surface transient `"No active follow for this chain"` errors when the host pauses and resumes (visibility blur, app backgrounding, network blips). The chain layer waits briefly for the papp's refollow and routes operations issued during that window through the new follow once it's established.
- **host-container:** dead chain-head follow state is cleaned up after server-driven stops, so long-running papps no longer accumulate stale follow records across many reconnect cycles.
- **product-sdk:** chain-head follows are now released on the product side as soon as the host signals a stop. Without this, every reconnect (sleep/wake, network blips) leaked a follow worth of pinned runtime metadata; over a long-running session this could grow into the gigabyte range.
- **host-substrate-chain-connection:** `chains.pauseAll()` / `resumeAll()` continue to drive the socket over the full lifetime of the host. Previously, after a chain was destroyed and re-acquired (the typical pattern when the host caches one provider per chain), pause and resume could silently no-op.
- **host-substrate-chain-connection:** subscriptions on non-chainHead RPCs (e.g. `state_subscribeStorage`, `statement_subscribeStatement`) keep emitting events after a reconnect. Previously they could silently go quiet because the server had assigned a new subscription ID that the consumer never adopted.
- **statement-store:** after `lazyClient.disconnect()`, subsequent calls to `getClient()` / `getRequestFn()` / `getSubscribeFn()` create a fresh connection instead of returning a destroyed one.
- **host-worker-sandbox:** each sandbox now runs in its own isolated QuickJS WASM instance instead of sharing a process-wide module. Previously, disposing a sandbox with live JS state (event listeners, in-flight async chains, captured closures) tripped QuickJS's `JS_FreeRuntime` assertion and aborted the shared WASM module — killing every other product worker (signing, accounts, chat) until page reload. The dispose path is now wrapped in try/catch so a contained abort no longer bubbles. Trade: ~50–200ms extra startup and ~2–3MB resident memory per sandbox.
- **host-papp:** SSO `signPayload` / `signRaw` queue tasks now time out after 180s instead of wedging the per-session request queue forever.
- **host-papp-react-ui:** bump `@novasamatech/tr-ui` to 0.2.7.

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.7.4 (2026-04-29)

### 🚀 Features

- **host-api:** add `host_get_user_id` protocol method (RFC-0014). Returns the user's primary DotNS username scoped to the calling product, with `GetUserIdErr` (`PermissionDenied | NotConnected | Unknown`).
- **host-container:** add `handleGetUserId` handler slot (RFC-0014).
- **product-sdk:** add `getUserId()` method to `createAccountsProvider()`.

### 🩹 Fixes

- **host-api:** fixed order of `host_sign_raw` and `host_sign_payload` methods in protocol to match the order of the methods in v0.6.
- **host-papp-react-ui:** bump tr-ui and fix storybook

### ⚠️ Breaking Changes

- **host-api:** order of methods inside Host API protocol changed. Affected all users of `0.7.0` - `0.7.3` releases.
- **host-api:** removed `host_account_get_root` (RFC-0010 superseded by RFC-0014). Use `host_get_user_id` to obtain the user's primary username.
- **host-api:** split `Account` into `ProductAccount` (no `name`) and `LegacyAccount` (carries `name`). `host_account_get` now returns `ProductAccount`; `host_get_legacy_accounts` now returns `Vec<LegacyAccount>`.
- **host-container:** removed `handleAccountGetRoot` (replaced by `handleGetUserId`).
- **product-sdk:** removed `getRootAccount()` (replaced by `getUserId()` returning `{ primaryUsername }`).
- **product-sdk:** `getProductAccount()` no longer returns `name` — use `getUserId()` for the user's display name.

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat
- valentunn @valentunn

## 0.7.3 (2026-04-27)

### 🩹 Fixes

- **host-api:** optimized message parsing in transport
- **host-papp:** queue session requests
- **host-papp:** remove redundant address check in sso sign methods

### Chore

- Update typescript to v6

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.7.2 (2026-04-24)

### 🚀 Features

- **host-container:** added an automatic permission gate for `handlePushNotification` method.

### 🩹 Fixes

- **host-api:** reorder actions in the protocol so all v0.7-new methods come after pre-v0.7 ones. Eliminating the ABI break that 0.7.0 introduced for existing methods.
- **product-sdk:** add buffer detach before sending content to Electron IPC

### ⚠️ Breaking Changes

- **product-sdk:** `TopUpSource.productAccount` now carries only `derivationIndex`; the `dotNsIdentifier` field is gone.

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.7.1 (2026-04-22)

### 🚀 Features

- **host-api:** parametrize subscription `interrupt` messages with a per-subscription payload type. `Subscription` is now generic (`Subscription<InterruptPayload = unknown>`) and exposes `onInterrupt(cb)`. Every `{method}_interrupt` codec is explicit in `protocol/v1`: `_void` for subscriptions without a reason.
- **product-sdk:** subscription helpers (`subscribeTheme`, `subscribeAccountConnectionStatus`, `subscribeBalance`, `subscribePaymentStatus`, `subscribeChatList`, `subscribeAction`, `subscribeStatementStore`, preimage `lookup`) now return `Subscription<I>` and surface `onInterrupt`.
- **host-substrate-chain-connection:** add pause/resume to drop the inner socket cleanly.

### ⚠️ Breaking Changes

- **host-api:** `remote_permission` request changed from `Vec<RemotePermission>` to a single `RemotePermission`. Callers must now issue one call per permission.
- **host-container:** subscription `interrupt` messages carry a payload. `handleSubscription` handlers must call `interrupt(payload)` — the no-arg form is gone. `Transport.subscribe` return type is now `Subscription<InterruptPayload>`.

### ❤️ Thank You

- cuteWarmFrog
- Sergey Zhuravlev @johnthecat

## 0.7.0 (2026-04-13)

See [migration guide](./docs/migration/v0.7.md) for details.

### 🚀 Features

- **host-papp:** update to polkadot-api v2.0
- **host-api:** add `host_theme_subscribe` protocol method
- **host-api:** add payment API (RFC-0006)
- **host-api:** add `host_derive_entropy` protocol method for deterministic entropy derivation (RFC-0007)
- **host-api:** replace `address: string` with `ProductAccountId` in `host_sign_raw` and `host_sign_payload` methods
- **host-api:** add legacy account signing methods (`host_sign_raw_with_legacy_account`, `host_sign_payload_with_legacy_account`)
- **host-api:** expand `DevicePermission` with new variants: `Notifications`, `NFC`, `Clipboard`, `OpenUrl`, `Biometrics`
- **host-api:** update `RemotePermission` to support `Remote`, `WebRTC`, `ChainSubmit`, `PreimageSubmit`, `StatementSubmit`
- **host-api:** update `remote_statement_store_subscribe` method to support latest changes in SS API (RFC-0008)
- **host-api:** add `host_account_get_root` protocol method (RFC-0010)
- **host-api:** add `host_request_login` protocol method and `LoginErr`/`LoginResult` codecs (RFC-0009)
- **host-container:** add `handleDeriveEntropy` handler slot
- **host-container:** add permission-gated request handling for preimage and statement submit
- **host-container:** add handler slots for `handleThemeSubscribe`, `handlePaymentBalanceSubscribe`, `handlePaymentTopUp`, `handlePaymentRequest`, `handlePaymentStatusSubscribe`, `handleSignRawWithLegacyAccount`, `handleSignPayloadWithLegacyAccount`
- **host-container:** add `handleAccountGetRoot` handler slot for JIT permission-prompted root account access
- **host-container:** add `handleRequestLogin` handler slot (RFC-0009)
- **product-sdk:** add `deriveEntropy` function
- **product-sdk:** add `createThemeProvider` for theme subscription
- **product-sdk:** add `createPaymentManager` and `paymentManager` for payment operations
- **product-sdk:** add `requestDevicePermission` and `requestPermission` for RFC-0002 permission model
- **product-sdk:** update `createStatementStore().subscribe` to accept `StatementTopicFilter` and deliver `StatementsPage` with `isComplete` flag (RFC-0008)
- **product-sdk:** add `getRootAccount()` method to `createAccountsProvider()` — returns `ResultAsync<Account, RequestCredentialsErr>`
- **product-sdk:** add `requestLogin()` method to `createAccountsProvider()` (RFC-0009)

### ⚠️ Breaking Changes

- **host-api:** renamed all `*_with_non_product_account` wire methods to `*_with_legacy_account` (`host_get_legacy_accounts`, `host_create_transaction_with_legacy_account`, `host_sign_raw_with_legacy_account`, `host_sign_payload_with_legacy_account`)
- **host-api:** `host_sign_raw` and `host_sign_payload` request payloads now use `account: ProductAccountId` instead of `address: string`
- **host-api:** `RemotePermission` enum restructured — old `ExternalRequest` and `TransactionSubmit` variants replaced
- **host-api:** `remote_statement_store_subscribe` start payload changed from `Vec<Topic>` to `TopicFilter`; receive payload changed from `Vec<SignedStatement>` to `SignedStatementsPage`
- **host-container:** renamed handler slots `handleGetNonProductAccounts`, `handleCreateTransactionWithNonProductAccount`, `handleSignRawWithNonProductAccount`, `handleSignPayloadWithNonProductAccount` to their `LegacyAccount` equivalents
- **host-container:** `JsonRpcProvider` is now imported from `polkadot-api` (polkadot-api v2.0)
- **product-sdk:** renamed `getNonProductAccounts` → `getLegacyAccounts`, `getNonProductAccountSigner` → `getLegacyAccountSigner`, `createNonProductExtensionEnableFactory` → `createLegacyExtensionEnableFactory`
- **product-sdk:** `createStatementStore().subscribe` first argument changed from `Topic[]` to `StatementTopicFilter`; callback argument changed from `SignedStatement[]` to `StatementsPage`
- **statement-store:** `StatementStoreAdapter.queryStatements` and `subscribeStatements` first argument changed from `Uint8Array[]` to `TopicFilter`; `subscribeStatements` callback argument changed from `Statement[]` to `StatementsPage`

### Chore

- Optimize internal `hostApi` and container wrappers
- Add `knip` for dead code detection

### ❤️ Thank You

- Filippo
- Sergey Zhuravlev @johnthecat
- Yanaty
- valentunn @valentunn

## 0.6.18 (2026-04-15)

### 🚀 Features

- **handoff-service:** add handoff-service package for P2P file transfers via HOP ([#109](https://github.com/paritytech/triangle-js-sdks/pull/109))

### 🩹 Fixes

- **statement-store:** send JSON-RPC unsubscribe on subscription teardown ([#111](https://github.com/paritytech/triangle-js-sdks/pull/111))
- **statement-store:** buffer request statements to prevent race condition in waitForRequestMessage ([#119](https://github.com/paritytech/triangle-js-sdks/pull/119))

### ❤️ Thank You

- Alexandru Gheorghe
- Ilya Kalinin
- Sergey Zhuravlev @johnthecat

## 0.6.17 (2026-04-09)

### 🩹 Fixes

- **host-papp:** attestation service now listens to the best block instead of finalized ([538692c](https://github.com/paritytech/triangle-js-sdks/commit/538692c))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.6.16 (2026-04-09)

### 🩹 Fixes

- **host-papp:** attestation service now listens to the best block instead of finalized ([538692c](https://github.com/paritytech/triangle-js-sdks/commit/538692c))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.6.15 (2026-04-02)

### 🚀 Features

- **host-papp:** add paseo-next network and drop unstable ([#101](https://github.com/paritytech/triangle-js-sdks/pull/101))

### 🩹 Fixes

- **host-container:** Simplified chain connection api

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat
- Yanaty

## 0.6.14 (2026-04-02)

### 🚀 Features

- **statement-store:** implemented correct session initialization and batching logic ([#100](https://github.com/paritytech/triangle-js-sdks/pull/100))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.6.13 (2026-04-01)

### 🚀 Features

- **host-substrate-chain-connection:** add configurable destroyDelay to connection pool ([#96](https://github.com/paritytech/triangle-js-sdks/pull/96))
- **host-container:** handleChainConnection now supports transaction submit permission check ([#97](https://github.com/paritytech/triangle-js-sdks/pull/97))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.6.12 (2026-03-30)

### 🚀 Features

- **host-substrate-chain-connection:** remove withPolkadotSdkCompat usage, added enhanceBranch option to branched provider instead ([#91](https://github.com/paritytech/triangle-js-sdks/pull/91))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.6.11 (2026-03-27)

### 🚀 Features

- **host-substrate-chain-connection:** add withSubscriptionReplay provider enhancer ([#89](https://github.com/paritytech/triangle-js-sdks/pull/89))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.6.10 (2026-03-25)

### 🚀 Features

- **host-papp:** Add getRingVrfAlias. PB-302 ([#42](https://github.com/paritytech/triangle-js-sdks/pull/42))

### 🩹 Fixes

- **host-container:** correct container disposal ([#86](https://github.com/paritytech/triangle-js-sdks/pull/86))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat
- Yanaty

## 0.6.9 (2026-03-25)

### 🚀 Features

- **host-container:** add default handlers if user didn't provided one. ([#84](https://github.com/paritytech/triangle-js-sdks/pull/84))

### 🩹 Fixes

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.6.8 (2026-03-24)

### 🚀 Features

- Add host-worker-sandbox package. ([#71](https://github.com/paritytech/triangle-js-sdks/pull/71))

### 🩹 Fixes

- **host-container:** close MessagePort on provider dispose PB-310 ([#78](https://github.com/paritytech/triangle-js-sdks/pull/78))

### ❤️ Thank You

- Ilya Kalinin
- Sergey Zhuravlev
- Yanaty

## 0.6.7 (2026-03-23)

### 🚀 Features

- implement chain connection PB-332 ([#69](https://github.com/paritytech/triangle-js-sdks/pull/69))
- papp secret storage reexport ([#76](https://github.com/paritytech/triangle-js-sdks/pull/76))

### 🩹 Fixes

- qr styles ([#59](https://github.com/paritytech/triangle-js-sdks/pull/59))
- disable papp ws heartbeat timeout ([#70](https://github.com/paritytech/triangle-js-sdks/pull/70))

### ❤️ Thank You

- Ilya Kalinin
- Sergey Zhuravlev
- Yanaty

## 0.6.6 (2026-03-17)

### 🚀 Features

- product-react-renderer package with chat adapter integration ([#38](https://github.com/paritytech/triangle-js-sdks/pull/38))
- add Paseo stable stage endpoint ([#43](https://github.com/paritytech/triangle-js-sdks/pull/43))
- make logger configurable ([#19](https://github.com/paritytech/triangle-js-sdks/pull/19))
- add hostMetadata to sign-in payload. PB-293 ([#37](https://github.com/paritytech/triangle-js-sdks/pull/37))

### 🩹 Fixes

- correct error message for unknown signing error ([#36](https://github.com/paritytech/triangle-js-sdks/pull/36))
- qr styles ([#59](https://github.com/paritytech/triangle-js-sdks/pull/59))

### Chore

- RFC/features by .md files ([#57](https://github.com/paritytech/triangle-js-sdks/pull/57))

### ❤️ Thank You

- Filippo
- Ilya Kalinin
- Ryan Lee
- Sergey Zhuravlev
- Yanaty

## 0.6.5 (2026-02-27)

### 🚀 Features

- Support updated statement store api ([#33](https://github.com/paritytech/triangle-js-sdks/pull/33))


## 0.6.4 (2026-02-27)

### 🚀 Features

- OptionBool codec

### 🩹 Fixes

- Small custom renderer api changes ([ce7961c](https://github.com/paritytech/triangle-js-sdks/commit/ce7961c))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.6.3 (2026-02-27)

### 🩹 Fixes

- Fix codec for custom renderer's Button and Text 
- Pass message id to chat custom renderer
- Remove Error throw inside PAPI adapter if chain is not supported.

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.6.1 (2026-02-20)

### 🩹 Fixes

- correct import of verifible js ([524b297](https://github.com/paritytech/triangle-js-sdks/commit/524b297))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.6.0 (2026-02-20)

### 🚀 Features

Host API
- Implemented `host_account_connection_status_subscribe` method for receiving current sign in status of the host.
- Implemented `product_chat_custom_message_render_subscribe` method with initial implementation of custom renderer.

PAPP integration
- Added support of `sign raw` method
  ⚠️ BREAKING CHANGE

Product SDK
- Implemented new method for custom message renderer in chat `productChat.onCustomMessageRenderingRequest`
- Implemented new method for Account status subscription `accountsProvider.subscribeAccountConnectionStatus`

Scale
- New `Record` codec
  ```ts
  const record = Record(u8); // <= Codec<{ [K: string]: number }>
  ```
- New `lazy` codec for recursive types
  ```ts
  type NodeType = { c: NodeType | void }

  const Node: Codec<NodeType> = Struct({
    c: Option(lazy(() => Node)),
  });
  ```

Chore:
- More e2e tests for Host API
- Codebase cleanup


### ❤️ Thank You

- Ilya Kalinin
- Sergey Zhuravlev @johnthecat
- Yanaty

## 0.5.5 (2026-02-17)

### 🚀 Features

- papp integration ([#5](https://github.com/paritytech/triangle-js-sdks/pull/5))
- Implemented correct Polkadot app pairing ui ([#6](https://github.com/paritytech/triangle-js-sdks/pull/6))
- Support new statement store errors while submitting statements ([#8](https://github.com/paritytech/triangle-js-sdks/pull/8))
- host api spec ([#7](https://github.com/paritytech/triangle-js-sdks/pull/7))
- chat ([#9](https://github.com/paritytech/triangle-js-sdks/pull/9))
- retry auth requests, add tests ([#12](https://github.com/paritytech/triangle-js-sdks/pull/12))
- added clearAll method to localStorageAdapter ([#11](https://github.com/paritytech/triangle-js-sdks/pull/11))
- add tr-ui, PairingPopover and theme support ([#10](https://github.com/paritytech/triangle-js-sdks/pull/10))
- update sdk to 0.5 spec ([#13](https://github.com/paritytech/triangle-js-sdks/pull/13))
- added a disconnect attempt and an error toast. PB-118 ([#15](https://github.com/paritytech/triangle-js-sdks/pull/15))
- changes for 0.5 release ([55ba140](https://github.com/paritytech/triangle-js-sdks/commit/55ba140))

### 🩹 Fixes

- Explicitly set account type to sr25519 in extension injector ([c942974](https://github.com/paritytech/triangle-js-sdks/commit/c942974))
- pairing ui logos and texts ([d99f67d](https://github.com/paritytech/triangle-js-sdks/commit/d99f67d))
- added Preview People Chain ([#14](https://github.com/paritytech/triangle-js-sdks/pull/14))

### ❤️ Thank You

- Ilya Kalinin
- Sergey Zhuravlev @johnthecat
- Yanaty

## 0.5.4 (2026-02-05)

### 🚀 Features

- host-container: webview integration provider
- host-container: new interface for chain connections
- product-sdk: statement store integration
- product-sdk: accounts manager API
- product-sdk: chat manager API

### 🩹 Fixes

- correct disposal of chain connection ([01e3985](https://github.com/paritytech/triangle-js-sdks/commit/01e3985))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.5.3-0 (2026-01-11)

### 🚀 Features

- papp integration ([#5](https://github.com/novasamatech/spektr-sdk/pull/5))
- Implemented correct Polkadot app pairing ui ([#6](https://github.com/novasamatech/spektr-sdk/pull/6))
- Support new statement store errors while submitting statements ([#8](https://github.com/novasamatech/spektr-sdk/pull/8))
- host api spec ([#7](https://github.com/novasamatech/spektr-sdk/pull/7))
- externalized scale helpers into separated library ([d8d3826](https://github.com/novasamatech/spektr-sdk/commit/d8d3826))
- host chat package WIP ([be14c03](https://github.com/novasamatech/spektr-sdk/commit/be14c03))

### 🩹 Fixes

- Explicitly set account type to sr25519 in extension injector ([c942974](https://github.com/novasamatech/spektr-sdk/commit/c942974))
- pairing ui logos and texts ([d99f67d](https://github.com/novasamatech/spektr-sdk/commit/d99f67d))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.5.2 (2026-01-08)

### 🩹 Fixes

- pairing ui logos and texts ([d99f67d](https://github.com/novasamatech/spektr-sdk/commit/d99f67d))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.5.1 (2026-01-06)

### 🩹 Fixes

- Explicitly set account type to sr25519 in extension injector ([c942974](https://github.com/novasamatech/spektr-sdk/commit/c942974))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.5.0 (2026-01-06)

### 🚀 Features

- Polkadot app integration ([#5](https://github.com/novasamatech/spektr-sdk/pull/5))
- Support new statement store errors while submitting statements ([#8](https://github.com/novasamatech/spektr-sdk/pull/8))
- Implemented Polkadot app pairing ui ([#6](https://github.com/novasamatech/spektr-sdk/pull/6))
- Host API according proposal ([#7](https://github.com/novasamatech/spektr-sdk/pull/7))
  - Chat integration API
  - Local Storage API

### ⚠️  Breaking Changes

- Completely new Host API spec that is not compatible with previous versions;
- New API of container from `host-container` package;
- `createSpektrPapiProvider` renamed to `createPapiProvider` in `product-sdk` package.

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.4.1 (2025-11-26)

### 🩹 Fixes

- simplified createTransaction codec ([6916a58](https://github.com/novasamatech/spektr-sdk/commit/6916a58))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.4.0 (2025-11-26)

### 🚀 Features

- new package names, removed shared package ([283640d](https://github.com/novasamatech/spektr-sdk/commit/283640d))

### ⚠️  Breaking Changes

- Package renaming
  - `@novasamatech/spektr-sdk` -> `@novasamatech/product-sdk`
  - `@novasamatech/spektr-dapp-host-container` -> `@novasamatech/host-container`
  - `@novasamatech/spektr-sdk-transport` -> `@novasamatech/host-api`
  - `@novasamatech/spektr-sdk-shared` -> Removed


### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.3.0 (2025-11-23)

### 🩹 Fixes

- Optimized hex encoding/decoding. ([017068e](https://github.com/novasamatech/spektr-sdk/commit/017068e))

### ⚠️  Breaking Changes

- Optimized hex encoding/decoding. Breaking change on transport layer.

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.2.0 (2025-11-23)

### 🚀 Features

- ⚠️  Support `createTransaction` interface ([3dc97ab](https://github.com/novasamatech/spektr-sdk/commit/3dc97ab))

### ⚠️  Breaking Changes

- `container.handleSignRequest` now has a required createTransaction method.
- `createIframeProvider` now accepts a params object instead of separate arguments.

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.1.0 (2025-11-22)

### 🚀 Features

- connection status listening ([2570ea2](https://github.com/novasamatech/spektr-sdk/commit/2570ea2))

### 🩹 Fixes

- husky config ([b175369](https://github.com/novasamatech/spektr-sdk/commit/b175369))
- node versions in github action ([7c0303c](https://github.com/novasamatech/spektr-sdk/commit/7c0303c))
- code style ([2e86aa4](https://github.com/novasamatech/spektr-sdk/commit/2e86aa4))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.0.16 (2025-10-16)

First release with experimental API.
