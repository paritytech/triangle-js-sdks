---
title: "Host API v0.2 Design"
type: design
status: draft
author: "@filvecchiato"
created: 2026-03-27
pr:
---

# Host API v0.2

Builds on [protocol design v0.6](host-api-protocol.md). JAM codec, request/response and subscription patterns carry forward.

Methods marked **[v0.2]** are new or changed. All others carry forward from v0.1.

## General

```rust
/// Must be the first request processed. Both Host and Product
/// must respond. Implementations may timeout after 10 seconds. Result is cached.
fn host_handshake(version: ProtocolVersion) -> Result<(), HandshakeErr>;

/// Query whether the host supports a given feature (e.g. a specific chain by genesis hash).
/// Used by the product to configure itself according to host capabilities.
fn host_feature_supported(feature: Feature) -> Result<bool, GenericErr>;

/// Send a native push notification to the user through the host.
fn host_push_notification(text: str) -> Result<(), GenericErr>;

/// Navigate the host to a deep link URI. Used for cross-product navigation (e.g. payment flows).
fn host_navigate_to(deeplink: str) -> Result<(), NavigateToErr>;
```

## Permissions

**[v0.2]** `DevicePermissionRequest` (4 variants) → `DevicePermission` (9 variants). `RemotePermissionRequest` → batched `Vec<RemotePermission>`. [RFC 0001](https://github.com/paritytech/triangle-js-sdks/pull/66) | [#64](https://github.com/paritytech/triangle-js-sdks/issues/64)

```rust
/// Request a single device-level permission from the user. Adds an additional security layer
/// on top of platform permissions (web, iOS, Android). Returns true if granted.
fn host_device_permission(permission: DevicePermission) -> Result<bool, GenericErr>;       // [v0.2]

/// Request one or more remote-access permissions in a single batch. The host presents one
/// consolidated prompt. Returns true if all requested permissions are granted.
fn remote_permission(permissions: Vec<RemotePermission>) -> Result<bool, GenericErr>;      // [v0.2]
```

```rust
enum DevicePermission {
  Notifications,  // [v0.2] send native push notifications
  Camera,         // access device camera
  Microphone,     // access device microphone
  Bluetooth,      // access Bluetooth peripherals
  Nfc,            // [v0.2] NFC tag read/write (tap-to-pay, physical events)
  Location,       // access device geolocation
  Clipboard,      // [v0.2] read/write system clipboard
  OpenUrl,        // [v0.2] open URLs in the system browser (navigate outside host)
  Biometrics      // [v0.2] trigger biometric auth (fingerprint, Face ID)
}

enum RemotePermission {
  Remote(Vec<String>),  // HTTP/HTTPS/WS/WSS with domain-pattern matching ("*.example.com")
  WebRtc,               // WebRTC connections (may expose user IP)
  ChainSubmit,          // broadcast transactions via remote_chain_transaction_broadcast
  StatementSubmit       // submit statements via remote_statement_store_submit
}
```

JIT prompt-once lifecycle: "Allow always" / "This time only" / "Never". Business methods implicitly trigger prompts if not yet resolved.

## Storage

```rust
/// Read a value from host-side key-value storage. Each product can only access its own keys.
fn host_local_storage_read(key: LocalStorageKey) -> Result<Option<LocalStorageValue>, LocalStorageErr>;

/// Write a value to host-side key-value storage. Each product can only access its own keys.
fn host_local_storage_write(key: LocalStorageKey, value: LocalStorageValue) -> Result<(), LocalStorageErr>;

/// Delete a key from host-side key-value storage. Each product can only access its own keys.
fn host_local_storage_clear(key: LocalStorageKey) -> Result<(), LocalStorageErr>;
```

## Accounts

```rust
/// Subscribe to changes in the user's account connection status (Connected / Disconnected).
fn host_account_connection_status_subscribe(callback: fn(AccountConnectionStatus)) -> Result<Subscriber, GenericErr>;

/// Get the product-scoped account for the given domain. Returns the derived public key and optional name.
fn host_account_get(domain: ProductAccountId) -> Result<Account, RequestCredentialsErr>;

/// Get a contextual alias (pseudonymous identity) for the given domain. Context is blake2b(product_derivation_path).
fn host_account_get_alias(domain: ProductAccountId) -> Result<ContextualAlias, RequestCredentialsErr>;

/// Create a RingVRF proof for the given account within the specified ring, binding the provided message.
fn host_account_create_proof(domain: ProductAccountId, ring: RingLocation, message: Vec<u8>) -> Result<RingVrfProof, CreateProofErr>;

/// returns the account at the base derivation path from which all product accounts are derived
fn host_get_non_product_accounts() -> Result<Vec<Account>, RequestCredentialsErr>;

/// [v0.2] Get the user's primary DotNS identifier and public key. Requires JIT user approval
/// because it reveals cross-context identity. The host may let the user select an alternative name.
fn host_get_user_id() -> Result<UserIdentity, UserIdentityError>;
```

```rust
struct UserIdentity {
  dot_ns_identifier: str,
  public_key: PublicKey
}
```

## Entropy

**[v0.2]** New group. [RFC 0007](https://github.com/paritytech/triangle-js-sdks/pull/95) | [polkadot-desktop#117](https://github.com/paritytech/polkadot-desktop/issues/117)

```rust
/// [v0.2] Derive 32 bytes of deterministic entropy scoped to the calling product and a
/// caller-chosen key. Same root account + product + key always yields the same output.
/// Different products derive independent entropy from the same root account.
fn host_derive_entropy(key: Vec<u8>) -> Result<Entropy, DeriveEntropyError>;
```

Derivation scheme (three-layer BLAKE2b-256 keyed hashing):

```
rootEntropySource    = blake2b256_keyed(rootAccountSecret, b"product-entropy-derivation")
perProductEntropy    = blake2b256_keyed(rootEntropySource, blake2b256(productId))
requestedEntropy     = blake2b256_keyed(perProductEntropy, key)
```

## Signing

**[v0.2]** `address: String` replaced by `account: ProductAccountId` in `SigningPayload` and `SigningRawPayload`. [RFC 0005](https://github.com/paritytech/triangle-js-sdks/pull/82) | [#40](https://github.com/paritytech/triangle-js-sdks/issues/40)

```rust
/// Build and sign a transaction for the given product account.
/// The host resolves the signing key from the ProductAccountId derivation hierarchy.
fn host_create_transaction(account_id: ProductAccountId, payload: VersionedTxPayload) -> Result<Vec<u8>, CreateTransactionErr>;

/// Build and sign a transaction with a non-product (imported) account. The host uses the
/// signer field in the payload to locate the appropriate key.
fn host_create_transaction_with_non_product_account(payload: VersionedTxPayload) -> Result<Vec<u8>, CreateTransactionErr>;

/// [v0.2] Sign raw bytes. Similar to injectedWeb3.signRaw, but signer is identified by
/// ProductAccountId instead of address string.
fn host_sign_raw(payload: SigningPayloadRaw) -> Result<SigningResult, SigningErr>;

/// [v0.2] Sign a structured JSON payload. Similar to injectedWeb3.signPayload, but signer
/// is identified by ProductAccountId instead of address string.
fn host_sign_payload(payload: SigningPayload) -> Result<SigningResult, SigningErr>;
```

## Payment

**[v0.2]** New group. [RFC 0006](https://github.com/paritytech/triangle-js-sdks/pull/94) | [#41](https://github.com/paritytech/triangle-js-sdks/issues/41)

```rust
/// [v0.2] Subscribe to the user's payment balance. Requires user consent on first call.
/// Emits updates whenever the balance changes.
fn host_payment_balance_subscribe(callback: fn(PaymentBalance)) -> Result<Subscriber, PaymentBalanceError>;

/// [v0.2] Top up the user's balance from a product-controlled source (e.g. a one-time deposit
/// account whose private key the product holds). No user consent needed (always in user's favour).
fn host_payment_top_up(source: PaymentTopUpSource) -> Result<PaymentReceipt, PaymentTopUpError>;

/// [v0.2] Request a payment from the user to a destination. Prompts the user for authorization.
/// Returns a PaymentId for tracking settlement status. Assumes a single fixed payment asset.
fn host_payment_request(amount: Balance) -> Result<PaymentId, PaymentRequestError>;

/// [v0.2] Subscribe to the lifecycle of a payment by its ID. Emits Processing, then
/// Completed or Failed. Settlement is asynchronous (coinage UTXO model).
fn host_payment_status_subscribe(payment_id: PaymentId, callback: fn(PaymentStatus)) -> Result<Subscriber, PaymentStatusError>;
```

## Chat

```rust
/// Register a chat room for this product. The host adds it to the contact list on first call.
/// Duplicate room_id requests return Exists status. room_id must be unique and stable.
fn host_chat_create_room(room: ChatRoomRequest) -> Result<ChatRoomRegistrationResult, ChatRoomRegistrationErr>;

/// Register a bot for this product. The host must know about the bot before it can interact.
fn host_chat_register_bot(bot: ChatBot) -> Result<ChatBotRegistrationResult, ChatBotRegistrationErr>;

/// Subscribe to the list of chat rooms this product participates in (as room host or bot).
fn host_chat_list_subscribe(callback: fn(Vec<ChatRoom>)) -> Result<Subscriber, GenericErr>;

/// Post a message (text, rich text, actions, file, reaction, or custom) to a chat room.
fn host_chat_post_message(room_id: str, message: ChatMessageContent) -> Result<ChatPostMessageResult, ChatMessagePostingErr>;

/// Subscribe to user actions in chat: message posts, action button triggers, and bot commands.
fn host_chat_action_subscribe(callback: fn(ReceivedChatAction)) -> Result<Subscriber, GenericErr>;

/// Subscribe to incoming custom chat messages for product-specific handling.
fn product_chat_custom_message_subscribe(payload: ChatCustomMessagePayload, callback: fn(SerializedCustomChatMessage)) -> Result<Subscriber, GenericErr>;

/// Subscribe to render requests for custom chat messages. The product returns a CustomRendererNode
/// tree that the host renders natively.
fn product_chat_custom_message_render_subscribe(payload: ChatCustomMessagePayload, callback: fn(SerializedCustomChatMessage)) -> Result<Subscriber, GenericErr>;

/// [v0.2] Create a lightweight group chat room. Returns a join link for participants.
/// The host handles the UI with default rendering; no custom elements.
fn host_chat_create_simple_group(request: SimpleGroupChatRequest) -> Result<SimpleGroupChatResult, ChatRoomRegistrationErr>;
```

## Statement Store

**[v0.2]** `topics: Vec<Topic>` → `filter: TopicFilter` (supports wildcard positions). `submit` takes raw bytes and returns statement hash.

```rust
/// [v0.2] Subscribe to statements matching a topic filter. None entries in the filter act as
/// wildcards, matching any topic at that position. Mirrors polkadot-sdk TopicFilter.
fn remote_statement_store_subscribe(filter: TopicFilter, callback: fn(Vec<SignedStatement>)) -> Result<Subscriber, GenericErr>;

/// Create a statement proof (signature) for the given account and statement. The product must
/// write the proof to the statement's proof field before submitting.
fn remote_statement_store_create_proof(account: ProductAccountId, statement: Statement) -> Result<StatementProof, StatementProofErr>;

/// [v0.2] Submit a SCALE-encoded signed statement to the store. Returns the statement hash
/// on success. Takes raw bytes for encoding flexibility, aligning with the SSS node RPC interface.
fn remote_statement_store_submit(statement: Vec<u8>) -> Result<String, GenericErr>;
```

```rust
struct TopicFilter {
  topics: Vec<Option<Topic>>  // None entries match any topic
}
```

## Preimage

```rust
/// Subscribe to preimage lookups by hash. The host resolves how to retrieve the data
/// (bulletin chain, IPFS, smoldot, etc.). Emits None if not found, Some(bytes) when resolved.
fn remote_preimage_lookup_subscribe(key: Vec<u8>, callback: fn(Option<Vec<u8>>)) -> Result<Subscriber, GenericErr>;

/// Submit a preimage (raw bytes) to the network. Returns the hash of the submitted preimage.
fn remote_preimage_submit(value: Vec<u8>) -> Result<Vec<u8>, PreimageSubmitErr>;
```

## Chain Interaction

Unchanged from v0.6. All chain access via existing `remote_chain_*` methods. Mirrors the JSON-RPC [specification](https://paritytech.github.io/json-rpc-interface-spec/api.html) for Substrate nodes.

```rust
/// Subscribe to chain head events (initialized, new block, best block, finalized, operation results).
fn remote_chain_head_follow_subscribe(request: ChainHeadFollow, callback: fn(ChainHeadEvent)) -> Result<Subscriber, GenericErr>;

/// Get the header of a block by hash within an active follow subscription.
fn remote_chain_head_header(request: ChainHeadHeader) -> Result<Option<Vec<u8>>, GenericErr>;

/// Start an operation to retrieve the body (extrinsics) of a block by hash.
fn remote_chain_head_body(request: ChainHeadBody) -> Result<OperationStartedResult, GenericErr>;

/// Start an operation to query storage items at a block hash, with optional child trie.
fn remote_chain_head_storage(request: ChainHeadStorage) -> Result<OperationStartedResult, GenericErr>;

/// Start an operation to call a runtime function at a block hash with given parameters.
fn remote_chain_head_call(request: ChainHeadCall) -> Result<OperationStartedResult, GenericErr>;

/// Unpin one or more previously pinned block hashes within a follow subscription.
fn remote_chain_head_unpin(request: ChainHeadUnpin) -> Result<(), GenericErr>;

/// Resume a storage operation that is waiting for continuation.
fn remote_chain_head_continue(request: ChainHeadUnpin) -> Result<ChainHeadContinue, GenericErr>;

/// Abort an in-progress operation by its operation ID.
fn remote_chain_head_stop_operation(request: ChainHeadStopOperation) -> Result<(), GenericErr>;

/// Get the genesis hash for a chain.
fn remote_chain_spec_genesis_hash(request: GenesisHash) -> Result<Vec<u8>, GenericErr>;

/// Get the human-readable chain name.
fn remote_chain_spec_chain_name(request: GenesisHash) -> Result<str, GenericErr>;

/// Get chain properties (token symbol, decimals, etc.) as a JSON string.
fn remote_chain_spec_properties(request: GenesisHash) -> Result<str, GenericErr>;

/// Broadcast a signed transaction to the network. Returns an operation ID if accepted.
fn remote_chain_transaction_broadcast(request: TransactionBroadcast) -> Result<Option<str>, GenericErr>;

/// Stop broadcasting a previously submitted transaction.
fn remote_chain_transaction_stop(request: TransactionStop) -> Result<(), GenericErr>;
```

## Sandbox

| Category | APIs |
|----------|------|
| **Blocked** | JSON-RPC, raw HTTP, Workers (Workers/SharedWorkers/ServiceWorkers) |
| **JIT permission** | HTTPS, WebSockets, WebRTC |
| **Unrestricted** | IndexedDB, sessionStorage, LocalStorage (host-synced) |

## Summary

### New methods (7)

| Method | Group | RFC |
|--------|-------|-----|
| `host_get_user_id` | Accounts | |
| `host_chat_create_simple_group` | Chat | |
| `host_payment_balance_subscribe` | Payment | [RFC 0006](https://github.com/paritytech/triangle-js-sdks/pull/94) |
| `host_payment_top_up` | Payment | [RFC 0006](https://github.com/paritytech/triangle-js-sdks/pull/94) |
| `host_payment_request` | Payment | [RFC 0006](https://github.com/paritytech/triangle-js-sdks/pull/94) |
| `host_payment_status_subscribe` | Payment | [RFC 0006](https://github.com/paritytech/triangle-js-sdks/pull/94) |
| `host_derive_entropy` | Entropy | [RFC 0007](https://github.com/paritytech/triangle-js-sdks/pull/95) |

### Changed methods (6)

| Method | Change | RFC |
|--------|--------|-----|
| `host_device_permission` | `DevicePermissionRequest` (4) → `DevicePermission` (9) | [RFC 0001](https://github.com/paritytech/triangle-js-sdks/pull/66) |
| `remote_permission` | Single request → batched `Vec<RemotePermission>` | [RFC 0001](https://github.com/paritytech/triangle-js-sdks/pull/66) |
| `host_sign_payload` | `address` → `account: ProductAccountId` | [RFC 0005](https://github.com/paritytech/triangle-js-sdks/pull/82) |
| `host_sign_raw` | `address` → `account: ProductAccountId` | [RFC 0005](https://github.com/paritytech/triangle-js-sdks/pull/82) |
| `remote_statement_store_subscribe` | `Vec<Topic>` → `TopicFilter` | |
| `remote_statement_store_submit` | `SignedStatement` → `Vec<u8>`; returns `String` | |

### Deferred to v0.3+

| Feature | RFC/Issue |
|---------|-----------|
| Chat Extension v2 (full) | [#54](https://github.com/paritytech/triangle-js-sdks/issues/54) |
| RingLocation redesign | [#56](https://github.com/paritytech/triangle-js-sdks/issues/56) |
| Contacts API | |
| Honour API | |
| HOP API | |
| Legacy account support | |

## References

- [Protocol Design v0.6](host-api-protocol.md)
- [RFC 0001 — Permission Model](https://github.com/paritytech/triangle-js-sdks/pull/66)
- [RFC 0005 — ProductAccountId in Signing](https://github.com/paritytech/triangle-js-sdks/pull/82)
- [RFC 0006 — Payment Host API](https://github.com/paritytech/triangle-js-sdks/pull/94)
- [RFC 0007 — Deterministic Entropy Derivation](https://github.com/paritytech/triangle-js-sdks/pull/95)
