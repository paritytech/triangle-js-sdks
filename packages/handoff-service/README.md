# @novasamatech/handoff-service

HOP (Handoff Pool) file transfer service for peer-to-peer chat. Uploads files to a Bulletin chain HOP pool as ChaCha20-Poly1305 encrypted entries and returns a compact identifier + claim ticket that the recipient uses to download and decrypt the file.

Non-custodial, ephemeral, end-to-end encrypted. The pool node only ever sees encrypted bytes. Wire format matches the iOS `HandoffService` and Android `HopFileUploader` implementations, and follows [chat-spec RFC 0001 — File Transfer Improvements](https://github.com/paritytech/chat-spec/pull/3).

## Installation

```shell
npm install @novasamatech/handoff-service --save -E
```

## Overview

A transfer happens in two roles:

- **Sender** generates a random 32-byte `ticket`. From the ticket the service derives an sr25519 keypair (signer) and a ChaCha20-Poly1305 key (encryption) via keyed blake2b (`khash(ticket, "signer" | "encryption")`). The file is packed into a versioned root entry — **inline** for small files, or a **chunk list** for large ones (see [Wire format](#wire-format)) — each entry is encrypted and submitted to the pool addressed to the ticket's public key. The root entry's hash is the file `identifier`. The sender ships `{ identifier, claimTicket }` through a side channel (the chat message).
- **Recipient** re-derives the encryption key and signing keypair from `claimTicket`, signs the canonical claim payload to prove ownership, and calls `hop_claim` to fetch the encrypted root entry. If the root entry is inline, the file is already complete; otherwise its chunk hashes are claimed and decrypted one by one, then concatenated to reconstruct the original bytes. Any entry the pool no longer holds is retried on-chain (see [On-chain fallback](#on-chain-fallback)).

```
┌────────┐   hop_submit(enc(entry), [pubkey])   ┌──────────┐   promotion    ┌──────────┐
│ Sender │ ───────────────────────────────────► │   HOP    │ ─────────────► │ on-chain │
└────────┘                                      │   Pool   │   pre-expiry   │ storage  │
     │                                          └──────────┘                └──────────┘
     │ identifier + claimTicket (via chat)           ▲                           ▲
     ▼                                               │                           │
┌───────────┐   hop_claim(hash, signature)           │                           │
│ Recipient │ ───────────────────────────────────────┘                           │
│           │   bitswap_v1_get(cid) — only if the claim returns NotFound         │
└───────────┘ ───────────────────────────────────────────────────────────────────┘
```

## Usage

### Upload a file

```typescript
import { createHopClient, uploadFile } from '@novasamatech/handoff-service';

// Your JSON-RPC transport — any function that calls methods on a HOP node.
const requestFn = <T>(method: string, params: unknown[]): Promise<T> =>
  wsClient.request(method, params);

const hopClient = createHopClient(requestFn);

const result = await uploadFile({
  data: fileBytes, // Uint8Array
  hopClient,
  onProgress: (sent, total) => console.info(`${sent}/${total} entries`),
});

if (result.isErr()) {
  console.error('Upload failed:', result.error);
} else {
  const { identifier, claimTicket } = result.value;
  // Send identifier + claimTicket to the recipient (e.g. inside an encrypted chat message).
}
```

### Download a file

```typescript
import { createHopClient, downloadFile } from '@novasamatech/handoff-service';

const hopClient = createHopClient(requestFn);

const result = await downloadFile({
  identifier, // Uint8Array from the sender
  claimTicket, // Uint8Array from the sender
  hopClient,
  onProgress: (received, total) => console.info(`${received}/${total} entries`),
});

if (result.isErr()) {
  console.error('Download failed:', result.error);
} else {
  const fileBytes = result.value; // Uint8Array — original file contents
}
```

### Inspect pool capacity

```typescript
const status = await hopClient.poolStatus();
// { entryCount, totalBytes, maxBytes }
```

## Wire format

The root pool entry — the one whose encrypted hash is the `identifier` — is a versioned SCALE envelope. Enum indices are normative (`v1` → 0; `inline` → 0, `chunked` → 1):

```
VersionedUploadedFile = { v1: { inline(Bytes) | chunked(ChunkedFile) } }
ChunkedFile           = { totalSize: u64, chunks: Vec<Bytes> }
```

- **Inline** — files of at most `chunkSize - 64` bytes travel whole inside the root entry. One pool entry, one claim, no chunk list. The 64-byte headroom covers the envelope bytes, the compact length prefix and the 28 bytes of ChaCha20-Poly1305 nonce and tag.
- **Chunked** — larger files are split into `chunkSize` pieces, each encrypted and submitted separately; the root entry lists their blake2b-256 hashes. `chunked` is byte-identical to the legacy bare `UploadedFile` layout after the two envelope bytes.

Downloads accept both the envelope and the legacy unversioned `UploadedFile` blob (versioned first, then legacy), since nothing in the message identifies the format and senders emitted bare `UploadedFile` before RFC 0001.

## On-chain fallback

An unacknowledged HOP entry is promoted to permanent on-chain storage shortly before it expires out of the pool. When `hop_claim` reports the entry as missing, `downloadFile` fetches it with `bitswap_v1_get` on the same JSON-RPC connection — so a transfer whose pool window has passed still completes, instead of failing terminally.

- `hop_claim` is always attempted first. The fallback is per entry, so one chunked file may mix pool-sourced and chain-sourced chunks.
- The CID is derived from the entry hash itself: CIDv1, codec `raw` (0x55), multihash blake2b-256 (0xb220) whose digest **is** the 32-byte entry hash, rendered in multibase base32-lower.
- Returned bytes are re-hashed with blake2b-256 and discarded on mismatch — the RPC path has no built-in integrity check, so this is the only integrity boundary.
- Chain-sourced entries are not acknowledged (the pool entry is already gone).
- `NotFound` and transport failures get bounded exponential backoff within the call, configurable via `DownloadParams.bitswapRetry`. `InvalidCid` (−32602) and a failed integrity check are never retried — re-asking the same node for the same CID cannot change the answer.

The RFC's outer retry policy — a 24-hour window per entry with backoff capped at 1 hour and rotation across Bulletin nodes — spans multiple sessions and connections, which a stateless loader over a single connection cannot own. Callers implement it by re-invoking `downloadFile` on their own schedule.

## API

### `createHopClient(requestFn): HopClient`

Wraps a JSON-RPC request function into a typed HOP client. `requestFn` is called with the raw method names `hop_submit`, `hop_claim`, `hop_ack`, `hop_poolStatus` and `bitswap_v1_get` — bring your own WebSocket / HTTP transport.

```typescript
type HopClient = {
  submit(data: Uint8Array, recipients: Uint8Array[]): ResultAsync<PoolStatus, Error>;
  claim(hash: Uint8Array, signature: Uint8Array): ResultAsync<Uint8Array, Error>;
  ack(hash: Uint8Array, signature: Uint8Array): ResultAsync<null, Error>;
  poolStatus(): ResultAsync<PoolStatus, Error>;
  bitswapGet(cid: string): ResultAsync<Uint8Array, Error>;
};
```

### `uploadFile(params): ResultAsync<UploadResult, Error>`

```typescript
type UploadParams = {
  data: Uint8Array;
  hopClient: HopClient;
  chunkSize?: number; // default 2_000_000
  onProgress?: (sent: number, total: number) => void;
};

type UploadResult = {
  identifier: Uint8Array; // blake2b-256 hash of the encrypted root entry
  claimTicket: Uint8Array; // 32-byte secret — share with recipient
};
```

### `downloadFile(params): ResultAsync<Uint8Array, Error>`

```typescript
type DownloadParams = {
  identifier: Uint8Array;
  claimTicket: Uint8Array;
  hopClient: HopClient;
  onProgress?: (received: number, total: number) => void;
  bitswapRetry?: Partial<BitswapRetryPolicy>;
};

type BitswapRetryPolicy = {
  maxAttempts: number; // default 3
  baseDelayMs: number; // default 10_000
  capDelayMs: number; // default 3_600_000
};
```

Reassembled bytes are validated against the `totalSize` encoded in the chunk list; a size mismatch produces an `Err`.

### Bitswap helpers

Exposed for callers implementing their own fetch loop or outer retry window:

```typescript
import { BitswapErrorCode, bitswapBytesMatchHash, hopBitswapCid } from '@novasamatech/handoff-service';

const cid = hopBitswapCid(entryHash); // 'bafk…' — CIDv1 / raw / blake2b-256
const usable = bitswapBytesMatchHash(bytes, entryHash);

BitswapErrorCode.invalidCid; // -32602 — never retry
BitswapErrorCode.notFound; // -32810 — retry, promotion may lag
BitswapErrorCode.internal; // -32812 — retry with backoff, or another node
```

### Crypto primitives

Exposed for advanced use cases (e.g. signing custom pool entries):

```typescript
import {
  generateTicket,
  derivePublicKey,
  deriveEncryptionKey,
  deriveSigningKeypair,
  signWithTicket,
  createFileEncryption,
} from '@novasamatech/handoff-service';

const ticket = generateTicket(); // 32 random bytes
const pubkey = derivePublicKey(ticket); // sr25519 public key
const signature = signWithTicket(ticket, messageBytes);

const enc = createFileEncryption(deriveEncryptionKey(ticket));
const ciphertext = enc.encrypt(plainBytes); // nonce(12) || ciphertext || tag(16)
const plain = enc.decrypt(ciphertext);
```

## Error handling

All async operations return `neverthrow` `ResultAsync`, so errors are values rather than thrown exceptions. Chain with `.andThen` / `.map` or unwrap via `.isErr()` / `.value` / `.error`.

JSON-RPC failures surface as `HopRpcError`, which preserves the server's numeric `code` so callers can distinguish a missing entry from a terminal error:

```typescript
import { HopErrorCode, HopRpcError } from '@novasamatech/handoff-service';

if (result.isErr() && result.error instanceof HopRpcError) {
  console.error(result.error.code, result.error.message);
  const missing = result.error.code === HopErrorCode.notFound; // 1004 — the pool no longer holds it
}
```

`HopErrorCode` (the `hop_*` methods) and `BitswapErrorCode` (`bitswap_v1_get`) are separate code spaces — the same condition has a different number on each RPC, matching the iOS and Android clients.
