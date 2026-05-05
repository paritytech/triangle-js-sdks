# @novasamatech/handoff-service

HOP (Handoff Pool) file transfer service for peer-to-peer chat. Uploads files to a Bulletin chain HOP pool as AES-256-GCM encrypted chunks and returns a compact identifier + claim ticket that the recipient uses to download and decrypt the file.

Non-custodial, ephemeral, end-to-end encrypted. The pool node only ever sees encrypted bytes. Wire format matches the iOS `HandoffService` and Android `HopFileUploader` implementations.

## Installation

```shell
npm install @novasamatech/handoff-service --save -E
```

## Overview

A transfer happens in two roles:

- **Sender** generates a random 32-byte `ticket`. From the ticket the service derives an sr25519 keypair (signer) and an AES-256-GCM key (encryption) via keyed blake2b (`khash(ticket, "signer" | "encryption")`). The file is split into 2 MB chunks, each chunk is AES-GCM encrypted and submitted to the pool addressed to the ticket's public key. A SCALE-encoded metadata blob listing all chunk hashes is then encrypted and submitted the same way — its hash is the file `identifier`. The sender ships `{ identifier, claimTicket }` through a side channel (the chat message).
- **Recipient** re-derives the encryption key and signing keypair from `claimTicket`, signs the identifier to prove ownership, and calls `hop_claim` to fetch the encrypted metadata. The metadata's chunk hashes are claimed and decrypted one by one, then concatenated to reconstruct the original bytes.

```
┌────────┐   hop_submit(enc(chunk_i), [pubkey])    ┌─────────┐
│ Sender │ ──────────────────────────────────────► │  HOP    │
│        │   hop_submit(enc(metadata), [pubkey])   │  Pool   │
└────────┘ ──────────────────────────────────────► └─────────┘
  ticket                                                ▲
     │                                                  │ hop_claim(hash, sig)
     │ identifier + claimTicket (via chat)              │
     ▼                                            ┌──────────┐
                                                  │ Recipient│
                                                  └──────────┘
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
  onProgress: (sent, total) => console.info(`${sent}/${total} chunks`),
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
  onProgress: (received, total) => console.info(`${received}/${total} chunks`),
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

## API

### `createHopClient(requestFn): HopClient`

Wraps a JSON-RPC request function into a typed HOP client. `requestFn` is called with the raw method names `hop_submit`, `hop_claim`, and `hop_poolStatus` — bring your own WebSocket / HTTP transport.

```typescript
type HopClient = {
  submit(data: Uint8Array, recipients: Uint8Array[]): ResultAsync<PoolStatus, Error>;
  claim(hash: Uint8Array, signature: Uint8Array): ResultAsync<Uint8Array, Error>;
  poolStatus(): ResultAsync<PoolStatus, Error>;
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
  identifier: Uint8Array; // blake2b-256 hash of the encrypted metadata
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
};
```

Reassembled bytes are validated against the `totalSize` encoded in the metadata; a size mismatch produces an `Err`.

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
