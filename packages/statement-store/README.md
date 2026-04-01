# @novasamatech/statement-store

Encrypted, signed messaging over a Polkadot statement store. Provides a session abstraction for sending and receiving typed request/response messages between two on-chain accounts.

## Overview

The library wraps the raw statement-store RPC into a typed session with:

- End-to-end AES-GCM encryption (ECDH shared secret via sr25519)
- sr25519 proof generation and verification on every statement
- Codec-based message serialization / deserialization
- Request/response correlation with automatic response acknowledgement

## Installation

```shell
npm install @novasamatech/statement-store --save -E
```

## Usage

```ts
import {
  createSession,
  createLocalSessionAccount,
  createRemoteSessionAccount,
  createAccountId,
  createSr25519Secret,
  deriveSr25519PublicKey,
  createSr25519Prover,
  createEncryption,
  createLazyClient,
  createPapiStatementStoreAdapter,
} from '@novasamatech/statement-store';
import { str } from 'scale-ts';

// 1. Derive local key pair from entropy
const localSecret = createSr25519Secret(entropy, '//wallet');
const localPublicKey = deriveSr25519PublicKey(localSecret);

// 2. Build account descriptors
const localAccount = createLocalSessionAccount(createAccountId(localPublicKey));
const remoteAccount = createRemoteSessionAccount(
  createAccountId(remotePublicKey),
  remotePublicKey,
);

// 3. Wire up the chain adapter
const client = createLazyClient(provider);
const statementStore = createPapiStatementStoreAdapter(client);

// 4. Create session dependencies
const prover = createSr25519Prover(localSecret);
const encryption = createEncryption(remoteAccount.publicKey);

// 5. Open session
const session = createSession({ localAccount, remoteAccount, statementStore, encryption, prover });

// Send a typed request and wait for the remote acknowledgement
const result = await session.request(str, 'hello');

// Clean up
session.dispose();
client.disconnect();
```

## API

### `createSession(params)`

Creates a `Session` for bidirectional typed messaging between two accounts.

```ts
function createSession(params: SessionParams): Session
```

**`SessionParams`**

| Property | Type | Description |
|---|---|---|
| `localAccount` | `LocalSessionAccount` | The local side of the session |
| `remoteAccount` | `RemoteSessionAccount` | The remote side of the session |
| `statementStore` | `StatementStoreAdapter` | Chain adapter for submitting/subscribing to statements |
| `encryption` | `Encryption` | Encryption instance (use `createEncryption`) |
| `prover` | `StatementProver` | Proof signer/verifier (use `createSr25519Prover`) |

**`Session` methods**

| Method | Signature | Description |
|---|---|---|
| `request` | `(codec, payload) → ResultAsync<void, Error>` | Submit a request and wait for the remote to acknowledge it. Resolves when the remote sends a success response; rejects on decoding/decryption failure or unknown error. |
| `submitRequestMessage` | `(codec, payload) → ResultAsync<{ requestId }, Error>` | Submit a request without waiting for a response. Returns the generated `requestId`. |
| `submitResponseMessage` | `(requestId, responseCode) → ResultAsync<void, Error>` | Send an explicit response to a request identified by `requestId`. |
| `waitForRequestMessage` | `(codec, filter) → ResultAsync<S, Error>` | Wait for the next incoming request whose decoded payload passes `filter`. Unsubscribes automatically once matched. |
| `waitForResponseMessage` | `(requestId) → ResultAsync<ResponseMessage, Error>` | Wait for the response to a specific outgoing request. |
| `subscribe` | `(codec, callback) → VoidFunction` | Subscribe to all incoming messages, decoded with `codec`. Returns an unsubscribe function. |
| `dispose` | `() → void` | Unsubscribe all active subscriptions created by this session. |

---

### Account factories

#### `createAccountId(value)`

Creates a 32-byte `AccountId` from a raw public key buffer.

```ts
function createAccountId(value: Uint8Array): AccountId
```

#### `createLocalSessionAccount(accountId, pin?)`

Creates a `LocalSessionAccount` representing the local participant.

```ts
function createLocalSessionAccount(accountId: AccountId, pin?: string): LocalSessionAccount
```

`pin` is an optional string used to namespace the session channel.

#### `createRemoteSessionAccount(accountId, publicKey, pin?)`

Creates a `RemoteSessionAccount` representing the remote participant. `publicKey` is used for shared-secret derivation and session ID computation.

```ts
function createRemoteSessionAccount(
  accountId: AccountId,
  publicKey: Uint8Array,
  pin?: string,
): RemoteSessionAccount
```

#### `createSessionId(sharedSecret, accountA, accountB)`

Derives a deterministic 32-byte session channel ID from a shared secret and two accounts.

```ts
function createSessionId(
  sharedSecret: Uint8Array,
  accountA: SessionAccount,
  accountB: SessionAccount,
): SessionId
```

---

### Encryption

#### `createEncryption(sharedSecret)`

Creates an `Encryption` instance that encrypts/decrypts payloads with AES-256-GCM. The shared secret is typically the remote account's public key (ECDH result).

```ts
function createEncryption(sharedSecret: Uint8Array): Encryption
```

`Encryption` interface:

| Method | Description |
|---|---|
| `encrypt(plaintext)` | Encrypts with a random 12-byte nonce prepended to the output |
| `decrypt(ciphertext)` | Strips the nonce prefix and decrypts |

---

### Proof generation

#### `createSr25519Prover(secret)`

Creates a `StatementProver` that signs and verifies statement proofs using sr25519.

```ts
function createSr25519Prover(secret: Uint8Array): StatementProver
```

`StatementProver` interface:

| Method | Description |
|---|---|
| `generateMessageProof(statement)` | Signs the statement and returns a `SignedStatement` |
| `verifyMessageProof(statement)` | Verifies the sr25519 signature on an incoming statement |

---

### Chain adapter

#### `createPapiStatementStoreAdapter(lazyClient)`

Creates a `StatementStoreAdapter` backed by the polkadot-api JSON-RPC client.

```ts
function createPapiStatementStoreAdapter(lazyClient: LazyClient): StatementStoreAdapter
```

`StatementStoreAdapter` interface:

| Method | Description |
|---|---|
| `queryStatements(topics, destination?)` | Fetch all current statements matching the given topics |
| `subscribeStatements(topics, callback)` | Subscribe to new statements on topics; returns unsubscribe function |
| `submitStatement(statement)` | Submit a signed statement; resolves on success, rejects with a typed error on failure |

#### `createLazyClient(provider)`

Creates a `LazyClient` that lazily initialises polkadot-api and substrate-client instances from a JSON-RPC provider.

```ts
function createLazyClient(provider: JsonRpcProvider): LazyClient
```

`LazyClient` methods:

| Method | Description |
|---|---|
| `getClient()` | Returns (or creates) a `PolkadotClient` |
| `getRequestFn()` | Returns a `RequestFn` for use with `sdk-statement` |
| `getSubscribeFn()` | Returns a `SubscribeFn` for use with `sdk-statement` |
| `disconnect()` | Destroys both underlying clients |

---

### Crypto utilities

Low-level sr25519 helpers used to produce keys and proofs.

#### `createSr25519Secret(entropy, derivation?)`

Derives an sr25519 secret key from raw entropy, optionally applying a derivation path (`//hard` or `/soft` segments).

```ts
function createSr25519Secret(entropy: Uint8Array, derivation?: string): Uint8Array
```

#### `createSr25519Derivation(secret, derivation)`

Applies a derivation path string to an existing sr25519 secret.

```ts
function createSr25519Derivation(secret: Uint8Array, derivation: string): Uint8Array
```

#### `deriveSr25519PublicKey(secret)`

Derives the sr25519 public key from a secret key.

```ts
function deriveSr25519PublicKey(secret: Uint8Array): Uint8Array
```

#### `signWithSr25519Secret(secret, message)`

Signs a message with an sr25519 secret key.

```ts
function signWithSr25519Secret(secret: Uint8Array, message: Uint8Array): Uint8Array
```

#### `verifySr25519Signature(message, signature, publicKey)`

Verifies an sr25519 signature. Returns `true` if valid.

```ts
function verifySr25519Signature(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean
```

#### `khash(secret, message)`

Computes a keyed blake2b-256 hash. Used internally to derive session channel IDs.

```ts
function khash(secret: Uint8Array, message: Uint8Array): Uint8Array
```
