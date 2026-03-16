---
title: "Host API Protocol Design"
type: design
status: accepted
created: 2026-03-13
---

# Host API Design Document

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| v0.6 | 2026-02-06 | Implemented `host_account_connection_status_subscribe` to track sign-in status; implemented `product_chat_custom_message_render_subscribe` for custom chat message rendering; redefined chain interaction section per latest implementation. |
| v0.5 | 2026-01-30 | Added namespaces to separate host integration from world-access methods; added device/remote permission requests; replaced JSON-RPC chain methods with high-level calls; added notification push method. |
| v0.4 | 2026-01-12 | Renamed `storage_*` to `local_storage_*`; removed direct permissions request (mutations return `PermissionDenied` error); redesigned chat for multiple rooms and bots; restored statement store methods. |
| v0.3 | 2026-01-03 | Defined subscription logic; moved message version to individual actions; fixed `ChatMessage::RichText` enum; added `ChatContactRegistrationStatus`. |
| v0.2 | 2025-12-27 | Removed statement store query/submit methods — all chain interaction via JSON-RPC. |
| v0.1 | 2025-12-18 | First implementation. |

## Overview

Host API is language-agnostic. All code examples are written in Rust, but authors can easily map these interfaces into other languages.

### Technical Requirements

- Solution MUST provide a transport layer between host and product.
- Message format MUST be well-defined and serializable to support different platforms.

## General Interface

```rust
// Host

fn host_handshake(
    version: ProtocolVersion
) -> Result<(), HandshakeErr>;

fn host_feature_supported(
    feature: Feature
) -> Result<bool, GenericErr>;

fn host_push_notification(
    text: str
) -> Result<(), GenericErr>;

fn host_navigate_to(
    deeplink: str
) -> Result<(), NavigateToErr>;

// Permissions

fn host_device_permission(
    permission: DevicePermissionRequest
) -> Result<bool, GenericErr>;

fn remote_permission(
    permission: RemotePermission
) -> Result<bool, GenericErr>;

// Storage

fn host_local_storage_read(
    key: LocalStorageKey
) -> Result<Option<LocalStorageValue>, LocalStorageErr>;

fn host_local_storage_write(
    key: LocalStorageKey,
    value: LocalStorageValue
) -> Result<(), LocalStorageErr>;

fn host_local_storage_clear(
    key: LocalStorageKey
) -> Result<(), LocalStorageErr>;

// Account

fn host_account_connection_status_subscribe(
    callback: fn(AccountConnectionStatus)
) -> Result<Subscriber, GenericErr>;

fn host_account_get(
    domain: ProductAccountId
) -> Result<Account, RequestCredentialsErr>;

fn host_account_get_alias(
    domain: ProductAccountId
) -> Result<ContextualAlias, RequestCredentialsErr>;

fn host_account_create_proof(
    domain: ProductAccountId,
    ring: RingLocation,
    message: Vec<u8>
) -> Result<RingVrfProof, CreateProofErr>;

fn host_get_non_product_accounts() -> Result<Account[], RequestCredentialsErr>;

// Signing

fn host_create_transaction(
    accountId: ProductAccountId,
    payload: VersionedTxPayload
) -> Result<Vec<u8>, CreateTransactionErr>;

fn host_create_transaction_with_non_product_account(
    accountId: AccountId,
    payload: VersionedTxPayload
) -> Result<Vec<u8>, CreateTransactionErr>;

fn host_sign_raw(
    payload: SigningPayloadRaw
) -> Result<SigningResult, SigningErr>;

fn host_sign_payload(
    payload: SigningPayloadJSON
) -> Result<SigningResult, SigningErr>;

// Chat

fn host_chat_create_room(
    room: ChatRoomRequest
) -> Result<ChatRoomRegistrationResult, ChatRoomRegistrationErr>;

fn host_chat_register_bot(
    bot: ChatBot
) -> Result<ChatBotRegistrationResult, ChatBotRegistrationErr>;

fn host_chat_list_subscribe(
    callback: fn(Vector<ChatRoom>)
) -> Result<Subscriber, GenericErr>;

fn host_chat_post_message(
    roomId: str,
    message: ChatMessage
) -> Result<ChatPostMessageResult, ChatMessagePostingErr>;

fn host_chat_action_subscribe(
    callback: fn(ChatAction)
) -> Result<Subscriber, GenericErr>;

fn product_chat_custom_message_render_subscribe(
    payload: ChatCustomMessagePayload,
    callback: fn(SerializedCustomChatMessage)
) -> Result<Subscriber, GenericErr>;

// Pocket (TODO)

// fn host_pocket_add_card(card: PocketCard) -> Result<PocketCardAddResult, PocketCardAddErr>;
// fn host_pocket_remove_card(cardId: str) -> Result<(), GenericErr>;
// fn host_pocket_rendering_subscribe() <- TODO
// fn host_pocket_action_triggered() <- TODO

// Statement Store

fn remote_statement_store_subscribe(
    topics: Vec<Topic>,
    callback: fn(Vec<SignedStatement>)
) -> Result<Subscriber, GenericErr>;

fn remote_statement_store_create_proof(
    account: ProductAccountId,
    statement: Statement
) -> Result<StatementProof, StatementProofErr>;

fn remote_statement_store_submit(
    statement: SignedStatement
) -> Result<(), GenericErr>;

// Preimage lookup

fn remote_preimage_lookup_subscribe(
    key: Vec<u8>,
    callback: fn(Option<Vec<u8>>)
) -> Result<Subscriber, GenericErr>;

fn remote_preimage_submit(
    value: Vec<u8>
) -> Result<Vec<u8>, PreimageSubmitErr>;

// Chain interaction

fn remote_chain_head_follow_subscribe(
    request: ChainHeadFollow,
    callback: fn(ChainHeadEvent)
) -> Result<Subscriber, GenericErr>;

fn remote_chain_head_header(
    request: ChainHeadHeader
) -> Result<Optional<Vec<u8>>, GenericErr>;

fn remote_chain_head_body(
    request: ChainHeadBody
) -> Result<OperationStartedResult, GenericErr>;

fn remote_chain_head_storage(
    request: ChainHeadStorage
) -> Result<OperationStartedResult, GenericErr>;

fn remote_chain_head_call(
    request: ChainHeadCall
) -> Result<OperationStartedResult, GenericErr>;

fn remote_chain_head_unpin(
    request: ChainHeadUnpin
) -> Result<(), GenericErr>;

fn remote_chain_head_continue(
    request: ChainHeadUnpin
) -> Result<ChainHeadContinue, GenericErr>;

fn remote_chain_head_stop_operation(
    request: ChainHeadStopOperation
) -> Result<(), GenericErr>;

fn remote_chain_spec_genesis_hash(
    request: GenesisHash
) -> Result<Vec<u8>, GenericErr>;

fn remote_chain_spec_chain_name(
    request: GenesisHash
) -> Result<str, GenericErr>;

fn remote_chain_spec_properties(
    request: GenesisHash
) -> Result<str, GenericErr>;

fn remote_chain_transaction_broadcast(
    request: TransactionBroadcast
) -> Result<Optional<str>, GenericErr>;

fn remote_chain_transaction_stop(
    request: TransactionStop
) -> Result<(), GenericErr>;
```

---

## Transport

Communication between Host and Product can be implemented with any IPC protocol. The body of an IPC message is a serialized `Message` (byte array). The IPC implementation may vary depending on the environment.

### Serialization

Messages are serializable structs that can be passed between peers. Message serialization is built on JAM codec.

All examples in this proposal skip JAM codec derive implementation calls, but they are implied. The field order of structs and enums matters. `Result` is also treated as a serializable enum.

> **Note on JAM codec:** JAM codec is based on SCALE codec with native support of the Compact type.

### Interface

Each message can be defined as:

```rust
struct Message {
    requestId: str,
    payload: Payload
}
```

`Payload` is an enum of possible actions.

- Actions MUST follow the order of Host API methods defined above for correct indices during serialization.
- Actions with defined payload MUST be versioned using `Versioned` enum:

```rust
enum Versioned {
    V1(Message)
    // ...
}
```

Actions MUST be derived from Host API methods using the following algorithm:

**For request functions**, actions should be derived as follows:

- **Request** — Name: `method_name + '_request'`, Argument: `Versioned<(arg1, arg2, ...)>`
- **Response** — Name: `method_name + '_response'`, Argument: `Versioned<Result<ReturnValue, ReturnError>>`

**For subscriptions**, there should be four different messages:

- **Subscribe** — Name: `method_name + '_start'`, Argument: tuple of all arguments except callback `Versioned<(arg1, arg2, ...)>`
- **Unsubscribe** — Name: `method_name + '_stop'`, Argument: none
- **Interrupt** — Name: `method_name + '_interrupt'`, Argument: none
- **Receive** — Name: `method_name + '_receive'`, Argument: versioned argument of callback function `Versioned<Message>`

Actions MUST be defined in the given order.

**Example:**

```rust
enum Payload {
    host_handshake_request(Versioned::V1(HandshakeVersion)),
    host_handshake_response(Versioned::V1(Result<(), GenericErr>)),

    // ...

    message_send_request(Versioned::V1((ChainId, str))),
    message_send_response(Versioned::V1(Result<(), GenericErr>)),

    message_subscribe_start(Versioned::V1(ChainId)),
    message_subscribe_stop,
    message_subscribe_interrupt,
    message_subscribe_receive(Versioned::V1(str))

    // ...
}
```

### Rules

#### Requests

Each Host or Product MUST send a response message for every request. Request and response MUST share the same `requestId` for matching on each side.

#### Subscriptions

`start`, `receive`, `interrupt` and `stop` calls MUST share the same `requestId` for matching inside subscription handlers.

- When a subscription starts, the consumer MUST notify the provider with a `start` message.
- When the consumer wants to unsubscribe, it MUST send a `stop` message.
- The provider MUST send data updates with a `receive` message.
- If the provider has trouble providing data, it CAN send an `interrupt` message to the consumer. The consumer MAY react to an interrupt message by notifying the application layer.

Returned `Subscriber` interface depends on implementation, but generic interface can look like this:

```rust
struct Subscriber {
    unsubscribe: fn(),
    onInterrupt: fn(fn())
}
```

---

## API Sections

### Common Interfaces

```rust
type GenesisHash = Vec<u8>;

struct GenericErr {
    reason: str
}
```

### Handshake

Handshake calls should be bidirectional. Both Host and Product can send handshake requests, and both MUST respond to them. Handshake implementations CAN include a timeout of 10 seconds, after which the connection is marked as failed and the method should return a `Timeout` error. The handshake result can be cached.

The handshake request contains `ProtocolVersion`, which is the version of the encoder in `u8`. The host or product should switch its encoding/decoding mode when `ProtocolVersion` is received.

For JAM codec, `ProtocolVersion = 1`.

A successful handshake request MUST be the first request processed by Host API. If any other request was sent before a successful handshake response, it should fail.

```rust
enum HandshakeErr {
    Timeout,
    UnsupportedProtocolVersion,
    Unknown(GenericErr)
}

type ProtocolVersion = u8;

fn host_handshake(
    version: ProtocolVersion
) -> Result<(), HandshakeErr>;
```

### Feature Support

The feature support request aims to configure the Product according to the Host context.

```rust
enum Feature {
    Chain(GenesisHash)
}

fn host_feature_supported(feature: Feature) -> Result<bool, GenericErr>;
```

### Device Permissions

Products can request additional device permissions. This device permissions check should be implemented on top of platform permissions (web, iOS, Android) and adds an additional security level.

```rust
enum DevicePermissionRequest {
    Camera,
    Microphone,
    Bluetooth,
    Location
}

fn host_device_permission(
    permission: DevicePermissionRequest
) -> Result<bool, GenericErr>;
```

### Local Storage

Local storage is a basic key-value storage implemented on the Host side. Each Product can read, store, and clear only its own values. A basic Host implementation can rely on a local DB, but it can also use some kind of on-chain data storage.

```rust
enum LocalStorageErr {
    Full,
    Unknown(GenericErr)
}

type LocalStorageKey = str;
type LocalStorageValue = Vec<u8>;

fn host_local_storage_read(
    key: LocalStorageKey
) -> Result<Option<LocalStorageValue>, LocalStorageErr>;

fn host_local_storage_write(
    key: LocalStorageKey,
    value: LocalStorageValue
) -> Result<(), LocalStorageErr>;

fn host_local_storage_clear(
    key: LocalStorageKey
) -> Result<(), LocalStorageErr>;
```

### Accounts

- **Product account** — account that belongs to the derivation hierarchy. These accounts are inherent to the mobile app and derived from the root user account.
- **Non-product account (NPA)** — other accounts imported in addition to the root account, allowing users to utilize existing accounts in the new system (e.g., in products).

```rust
enum RequestCredentialsErr {
    NotConnected,
    Rejected,
    DomainNotValid,
    Unknown(GenericErr)
}

enum CreateProofErr {
    RingNotFound,
    Rejected,
    Unknown(GenericErr)
}

type AccountId = [u8; 32];
type PublicKey = Vec<u8>;
type DotNsIdentifier = str;
type DerivationIndex = u32;
type ProductAccountId = (DotNsIdentifier, DerivationIndex);

struct Account {
    public_key: PublicKey,
    name: Option<str>
}

struct ContextualAlias {
    context: [u8; 32],
    alias: RingVrgAlias
}

struct RingLocationHint {
    pallet_instance: Option<u32>
}

struct RingLocation {
    genesis_hash: GenesisHash,
    ring_root_hash: Vec<u8>,
    hints: Option<RingLocationHint>
}

type RingVrfProof = Vec<u8>;

enum AccountConnectionStatus {
    Disconnected,
    Connected
}

fn host_account_connection_status_subscribe(
    callback: fn(AccountConnectionStatus)
) -> Result<Subscriber, GenericErr>;

fn host_account_get(
    domain: ProductAccountId
) -> Result<Account, RequestCredentialsErr>;

fn host_account_get_alias(
    domain: ProductAccountId
) -> Result<ContextualAlias, RequestCredentialsErr>;

fn host_account_create_proof(
    domain: ProductAccountId,
    ring: RingLocation,
    message: Vec<u8>
) -> Result<RingVrfProof, CreateProofErr>;

fn host_get_non_product_accounts() -> Result<Account[], RequestCredentialsErr>;
```

### Signing

#### Create Transaction

Based on the [polkadot-js extrinsic format](https://github.com/polkadot-js/api/issues/6213), but omitting the version field. This format supports both V4 and V5 extrinsics.

Two methods exist: `create_transaction` is bound to the Host API account model; `create_transaction_with_non_product_account` can request signing with any non-product account, and the host decides how to find or derive accounts for signing using the `signer` field as a reference.

```rust
enum CreateTransactionErr {
    FailedToDecode,
    Rejected,
    NotSupported(str),
    PermissionDenied,
    Unknown(GenericErr),
}

struct TxPayloadExtensionV1 {
    id: str,
    extra: Vec<u8>,
    additional_signed: Vec<u8>
}

struct TxPayloadContext {
    metadata: Vec<u8>,
    token_symbol: str,
    token_decimals: u32,
    best_block_height: u32
}

struct TxPayloadV1 {
    signer: Option<str>,
    call_data: Vec<u8>,
    extensions: Vec<TxPayloadExtensionV1>,
    tx_ext_version: u8,
    context: TxPayloadContext
}

enum VersionedTxPayload {
    V1(TxPayloadV1)
}

fn host_create_transaction(
    account_id: ProductAccountId,
    payload: VersionedTxPayload
) -> Result<Vec<u8>, CreateTransactionErr>;

fn host_create_transaction_with_non_product_account(
    payload: VersionedTxPayload
) -> Result<Vec<u8>, CreateTransactionErr>;
```

#### Signing Raw

Signing of raw bytes. The interface is similar to `signRaw` from injectedWeb3, added for backward compatibility.

```rust
enum SigningErr {
    FailedToDecode,
    Rejected,
    PermissionDenied,
    Unknown(GenericErr)
}

enum RawPayload {
    Bytes(Vec<u8>),
    Payload(str)
}

struct SigningPayloadRaw {
    address: str,
    data: RawPayload
}

struct SigningResult {
    signature: Vec<u8>,
    signed_transaction: Option<Vec<u8>>
}

fn host_sign_raw(
    payload: SigningPayloadRaw
) -> Result<SigningResult, SigningErr>;
```

#### Signing JSON Payload

Signing of JSON payload. The interface is similar to `signPayload` from injectedWeb3, added for backward compatibility.

```rust
struct SigningPayload {
    address: str,
    block_hash: Vec<u8>,
    block_number: Vec<u8>,
    era: Vec<u8>,
    genesis_hash: GenesisHash,
    method: Vec<u8>,
    nonce: Vec<u8>,
    spec_version: Vec<u8>,
    tip: Vec<u8>,
    transaction_version: Vec<u8>,
    signed_extensions: Vec<str>,
    version: u32,
    asset_id: Option<Vec<u8>>,
    metadata_hash: Option<Vec<u8>>,
    mode: Option<u32>,
    with_signed_transaction: Option<bool>
}

fn host_sign_payload(
    payload: SigningPayload
) -> Result<SigningResult, SigningErr>;
```

### Chat

This API section covers Product-Chat integration. There are two types of chat interactions: **Room Extension** and **Bot Extension**.

#### Room Extension

Product can create multiple rooms for direct product-user interactions.

##### Room Registration

Product MUST register itself as a room before sending any message. Host MUST add the Product to the contact list on the first call. If the Product requests creation of a room with the same `room_id`, the Host MUST deduplicate requests and send `Exists` status. `room_id` MUST be unique and stable across product presentations.

```rust
enum ChatRoomRegistrationErr {
    PermissionDenied,
    Unknown(GenericErr)
}

enum ChatRoomRegistrationStatus {
    New,
    Exists
}

struct ChatRoomRequest {
    room_id: str,
    name: str,
    icon: str // URL or base64-encoded image
}

struct ChatRoomRegistrationResult {
    status: ChatRoomRegistrationStatus
}

fn host_chat_create_room(
    room: ChatRoomRequest
) -> Result<ChatRoomRegistrationResult, ChatRoomRegistrationErr>;
```

##### Bot Registration

Host application should know about the existence of the Product's bot, so it must be registered first.

```rust
enum ChatBotRegistrationErr {
    PermissionDenied,
    Unknown(GenericErr)
}

struct ChatBot {
    bot_id: str,
    name: str,
    icon: str // URL or base64-encoded image
}

enum ChatBotRegistrationStatus {
    New,
    Exists
}

struct ChatBotRegistrationResult {
    status: ChatBotRegistrationStatus
}

fn host_chat_register_bot(
    bot: ChatBot
) -> Result<ChatBotRegistrationResult, ChatBotRegistrationErr>;
```

##### Receiving Chat List

Products can receive chat rooms via subscription.

```rust
enum ChatRoomParticipation {
    RoomHost,
    Bot
}

struct ChatRoom {
    room_id: str,
    participating_as: ChatRoomParticipation
}

fn host_chat_list_subscribe(
    callback: fn(Vector<ChatRoom>)
) -> Result<Subscriber, GenericErr>;
```

##### Sending Messages

```rust
enum ChatMessagePostingErr {
    MessageTooLarge,
    Unknown(GenericErr)
}

struct ChatAction {
    action_id: str,
    title: str
}

enum ChatActionLayout {
    Column,
    Grid
}

struct ChatActions {
    text: Option<str>,
    actions: Vec<ChatAction>,
    layout: ChatActionLayout
}

struct ChatMedia {
    url: str
}

struct ChatRichText {
    text: Option<str>,
    media: Vec<ChatMedia>
}

struct ChatFile {
    url: str,
    file_name: str,
    mime_type: str,
    size_bytes: u64,
    text: Option<str>
}

struct ChatReaction {
    message_id: str,
    emoji: str
}

struct ChatCustomMessage {
    id: str,
    payload: Vec<u8>
}

enum ChatMessageContent {
    Text(str),
    RichText(ChatRichText),
    Actions(ChatActions),
    File(ChatFile),
    Reaction(ChatReaction),
    ReactionRemoved(ChatReaction),
    CustomMessage(ChatCustomMessage)
}

struct ChatPostMessageResult {
    message_id: str
}

fn host_chat_post_message(
    room_id: str,
    payload: ChatMessageContent
) -> Result<ChatPostMessageResult, ChatMessagePostingErr>;
```

##### Subscribing to Actions

A Product can subscribe to user actions and react to them.

```rust
struct ActionTrigger {
    message_id: str,
    action_id: str,
    payload: Option<Vec<u8>>
}

struct ChatCommand {
    command: str,
    payload: str
}

enum ChatActionPayload {
    MessagePosted(ChatMessageContent),
    ActionTriggered(ActionTrigger),
    Command(ChatCommand)
}

struct ReceivedChatAction {
    room_id: str,
    peer: str,
    payload: ChatActionPayload
}

fn host_chat_action_subscribe(
    callback: fn(ReceivedChatAction)
) -> Result<Subscriber, GenericErr>;
```

##### Custom Chat Message Rendering

Host can subscribe to a custom chat renderer. Renderer primitives are described in the [Custom Renderer](#custom-renderer) section.

```rust
struct ChatCustomMessagePayload {
    messageId: str,
    messageType: str,
    payload: Vec<u8>
}

type SerializedCustomChatMessage = CustomRendererNode;

fn product_chat_custom_message_render_subscribe(
    payload: ChatCustomMessagePayload,
    callback: fn(SerializedCustomChatMessage)
) -> Result<Subscriber, GenericErr>;
```

### Statement Store

A Product MAY want to integrate with the statement store directly.

#### Common Structs

```rust
type Topic = [u8; 32];
type Channel = [u8; 32];
type DecryptionKey = [u8; 32];

struct Sr25519StatementProof {
    signature: [u8; 64],
    signer: [u8; 32]
}

struct Ed25519StatementProof {
    signature: [u8; 64],
    signer: [u8; 32]
}

struct EcdsaStatementProof {
    signature: [u8; 65],
    signer: [u8; 33]
}

struct OnChainStatementProof {
    who: [u8; 32],
    block_hash: [u8; 32],
    event: u64
}

enum StatementProof {
    Sr25519(Sr25519StatementProof),
    Ed25519(Ed25519StatementProof),
    Ecdsa(EcdsaStatementProof),
    OnChain(OnChainStatementProof)
}

struct Statement {
    proof: Option<StatementProof>,
    decryption_key: Option<DecryptionKey>,
    priority: Option<u32>,
    channel: Option<Channel>,
    topics: Vec<Topic>,
    data: Option<Vec<u8>>
}

struct SignedStatement {
    proof: StatementProof,
    decryption_key: Option<DecryptionKey>,
    priority: Option<u32>,
    channel: Option<Channel>,
    topics: Vec<Topic>,
    data: Option<Vec<u8>>
}
```

#### Receiving Statements

```rust
fn remote_statement_store_subscribe(
    topics: Vec<Topic>,
    callback: fn(Vec<SignedStatement>)
) -> Result<Subscriber, GenericErr>;
```

#### Creating Proof

Before submitting a statement, the Product MUST create a statement proof and write it to the `proof` field.

```rust
enum StatementProofErr {
    UnableToSign,
    UnknownAccount,
    Unknown(GenericErr)
}

fn remote_statement_store_create_proof(
    account: ProductAccountId,
    statement: Statement
) -> Result<StatementProof, StatementProofErr>;
```

#### Submitting Statement

After generating proof, product can submit statement to the store.

```rust
fn remote_statement_store_submit(
    statement: SignedStatement
) -> Result<(), GenericErr>;
```

### Chain Connection

A Product may want to interact with the world through Substrate blockchain. The Product MUST redirect all chain requests through Host API methods. At the SDK level, this can be defined as a custom PJS/PAPI provider. Methods defined in this section mirror the JSON-RPC specification for Substrate nodes.

```rust
type BlockHash = Vec<u8>;
type OperationId = str;

struct RuntimeApi(str, u32);

struct RuntimeSpec {
    spec_name: str,
    impl_name: str,
    spec_version: u32,
    impl_version: u32,
    transaction_version: Option<u32>,
    apis: Vec<RuntimeApi>
}

struct RuntimeInvalid {
    error: str
}

enum RuntimeType {
    Valid(RuntimeSpec),
    Invalid(RuntimeInvalid)
}

enum StorageQueryType {
    Value,
    Hash,
    ClosestDescendantMerkleValue,
    DescendantsValues,
    DescendantsHashes
}

struct StorageQueryItem {
    key: Vec<u8>,
    type: StorageQueryType
}

struct StorageResultItem {
    key: Vec<u8>,
    value: Option<Vec<u8>>,
    hash: Option<Vec<u8>>,
    closest_descendant_merkle_value: Option<Vec<u8>>
}

struct OperationStarted {
    operation_id: OperationId
}

enum OperationStartedResult {
    Started(OperationStarted),
    LimitReached
}

struct ChainHeadFollowV1Start {
    genesis_hash: GenesisHash,
    with_runtime: bool
}

struct ChainHeadEventInitialized {
    finalized_block_hashes: Vec<BlockHash>,
    finalized_block_runtime: Option<RuntimeType>
}

struct ChainHeadEventNewBlock {
    block_hash: BlockHash,
    parent_block_hash: BlockHash,
    new_runtime: Option<RuntimeType>
}

struct ChainHeadEventBestBlockChanged {
    best_block_hash: BlockHash
}

struct ChainHeadEventFinalized {
    finalized_block_hashes: Vec<BlockHash>,
    pruned_block_hashes: Vec<BlockHash>
}

struct ChainHeadEventOperationBodyDone {
    operation_id: OperationId,
    value: Vec<Vec<u8>>
}

struct ChainHeadEventOperationCallDone {
    operation_id: OperationId,
    output: Vec<u8>
}

struct ChainHeadEventOperationStorageItems {
    operation_id: OperationId,
    items: Vec<StorageResultItem>
}

struct ChainHeadEventOperationId {
    operation_id: OperationId
}

struct ChainHeadEventOperationError {
    operation_id: OperationId,
    error: str
}

enum ChainHeadEvent {
    Initialized(ChainHeadEventInitialized),
    NewBlock(ChainHeadEventNewBlock),
    BestBlockChanged(ChainHeadEventBestBlockChanged),
    Finalized(ChainHeadEventFinalized),
    OperationBodyDone(ChainHeadEventOperationBodyDone),
    OperationCallDone(ChainHeadEventOperationCallDone),
    OperationStorageItems(ChainHeadEventOperationStorageItems),
    OperationStorageDone(ChainHeadEventOperationId),
    OperationWaitingForContinue(ChainHeadEventOperationId),
    OperationInaccessible(ChainHeadEventOperationId),
    OperationError(ChainHeadEventOperationError),
    Stop
}

type ChainHeadFollowV1Receive = ChainHeadEvent;

struct ChainHeadHeader {
    genesis_hash: GenesisHash,
    follow_subscription_id: str,
    hash: BlockHash
}

struct ChainHeadBody {
    genesis_hash: GenesisHash,
    follow_subscription_id: str,
    hash: BlockHash
}

struct ChainHeadStorage {
    genesis_hash: GenesisHash,
    follow_subscription_id: str,
    hash: BlockHash,
    items: Vec<StorageQueryItem>,
    child_trie: Option<Vec<u8>>
}

struct ChainHeadCall {
    genesis_hash: GenesisHash,
    follow_subscription_id: str,
    hash: BlockHash,
    function: str,
    call_parameters: Vec<u8>
}

struct ChainHeadUnpin {
    genesis_hash: GenesisHash,
    follow_subscription_id: str,
    hashes: Vec<BlockHash>
}

struct ChainHeadContinue {
    genesis_hash: GenesisHash,
    follow_subscription_id: str,
    operation_id: OperationId
}

struct ChainHeadStopOperation {
    genesis_hash: GenesisHash,
    follow_subscription_id: str,
    operation_id: OperationId
}

struct TransactionBroadcast {
    genesis_hash: GenesisHash,
    transaction: Vec<u8>
}

struct TransactionStop {
    genesis_hash: GenesisHash,
    operation_id: str
}

fn remote_chain_head_follow_subscribe(
    request: ChainHeadFollow,
    callback: fn(ChainHeadEvent)
) -> Result<Subscriber, GenericErr>;

fn remote_chain_head_header(
    request: ChainHeadHeader
) -> Result<Optional<Vec<u8>>, GenericErr>;

fn remote_chain_head_body(
    request: ChainHeadBody
) -> Result<OperationStartedResult, GenericErr>;

fn remote_chain_head_storage(
    request: ChainHeadStorage
) -> Result<OperationStartedResult, GenericErr>;

fn remote_chain_head_call(
    request: ChainHeadCall
) -> Result<OperationStartedResult, GenericErr>;

fn remote_chain_head_unpin(
    request: ChainHeadUnpin
) -> Result<(), GenericErr>;

fn remote_chain_head_continue(
    request: ChainHeadUnpin
) -> Result<ChainHeadContinue, GenericErr>;

fn remote_chain_head_stop_operation(
    request: ChainHeadStopOperation
) -> Result<(), GenericErr>;

fn remote_chain_spec_genesis_hash(
    request: GenesisHash
) -> Result<Vec<u8>, GenericErr>;

fn remote_chain_spec_chain_name(
    request: GenesisHash
) -> Result<str, GenericErr>;

fn remote_chain_spec_properties(
    request: GenesisHash
) -> Result<str, GenericErr>;

fn remote_chain_transaction_broadcast(
    request: TransactionBroadcast
) -> Result<Optional<str>, GenericErr>;

fn remote_chain_transaction_stop(
    request: TransactionStop
) -> Result<(), GenericErr>;
```

### Custom Renderer

Host API implements custom rendering capabilities used inside custom chat message rendering and pocket. It is a render tree serialized into JAM-codec that can be passed to the Host to render with the native rendering engine.

The Product acts as a rendering backend, sending a new rendering tree on each state update. The Host is responsible for rendering this tree and wiring up all actions called on user interaction.

#### Props

Each component has its own unique set of props to parametrize output.

#### Modifiers

Modifiers are a set of values that modify the style of the output. Padding, background, or text color lives here.

#### Actions

To support callbacks, actions are unique plain text identifiers that can be used by action handlers (which may differ depending on actual renderer bindings for chat or pocket). The native Host renderer should call the action handler with an optional argument as defined by the action handler.

```rust
type Size = Compact<u32>;

struct Dimensions(
    Compact<u32>, // y if length=2 or top if length>2
    Compact<u32>, // x or right if length=4
    Option<Compact<u32>>, // bottom if length=3 or left if length=4
    Option<Compact<u32>>  // bottom
);

enum TypographyStyle {
    TitleXL,
    Headline,
    BodyM,
    BodyS,
    Caption
}

enum ButtonVariant {
    Primary,
    Secondary,
    Text
}

enum ColorToken {
    TextPrimary,
    TextSecondary,
    TextTertiary,
    BackgroundPrimary,
    BackgroundSecondary,
    BackgroundTertiary,
    Success,
    Error,
    Warning
}

enum ContentAlignment {
    TopStart,
    TopCenter,
    TopEnd,
    CenterStart,
    Center,
    CenterEnd,
    BottomStart,
    BottomCenter,
    BottomEnd
}

enum HorizontalAlignment {
    Start,
    Center,
    End
}

enum VerticalAlignment {
    Top,
    Center,
    Bottom
}

enum Arrangement {
    Start,
    End,
    Center,
    SpaceBetween,
    SpaceAround,
    SpaceEvenly
}

enum Shape {
    Rounded(Compact<u32>),
    Circle
}

struct BorderStyle {
    width: Compact<u32>,
    color: ColorToken,
    shape: Option<Shape>
}

struct Background {
    color: ColorToken,
    shape: Option<Shape>
}

enum Modifier {
    Margin(Dimensions),
    Padding(Dimensions),
    Background(Background),
    Border(BorderStyle),
    Height(Compact<u32>),
    Width(Compact<u32>),
    MinWidth(Compact<u32>),
    MinHeight(Compact<u32>),
    FillWidth(bool),
    FillHeight(bool)
}

struct Component<Props: Encode + Decode> {
    modifiers: Vec<Modifier>,
    props: Props,
    children: Vec<CustomRendererNode>
}

struct BoxProps {
    content_alignment: Option<ContentAlignment>
}

struct ColumnProps {
    horizontal_alignment: Option<HorizontalAlignment>,
    vertical_arrangement: Option<Arrangement>
}

struct RowProps {
    vertical_alignment: Option<VerticalAlignment>,
    horizontal_arrangement: Option<Arrangement>
}

struct TextProps {
    style: Option<TypographyStyle>,
    color: Option<ColorToken>
}

struct ButtonProps {
    text: String,
    variant: Option<ButtonVariant>,
    enabled: Option<bool>,
    loading: Option<bool>,
    click_action: Option<String>
}

struct TextFieldProps {
    text: String,
    placeholder: Option<String>,
    label: Option<String>,
    enabled: Option<bool>,
    value_change_action: Option<String>
}

enum CustomRendererNode {
    Nil,
    String(str),
    Box(Component<BoxProps>),
    Column(Component<ColumnProps>),
    Row(Component<RowProps>),
    Spacer(Component<()>),
    Text(Component<TextProps>),
    Button(Component<ButtonProps>),
    TextField(Component<TextFieldProps>)
}
```
