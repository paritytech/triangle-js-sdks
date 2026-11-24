import type { Result, ResultAsync } from 'neverthrow';
import { err, errAsync, fromSafePromise, ok, okAsync } from 'neverthrow';

import { VersionedUploadedFile, decodeRootEntry } from '../codec.js';
import {
  HopSigningPayloads,
  blake2b256,
  createFileEncryption,
  deriveEncryptionKey,
  derivePublicKey,
  generateTicket,
  signWithTicket,
} from '../crypto/index.js';
import type { HopClient } from '../rpc/index.js';
import { BitswapErrorCode, HopErrorCode, HopRpcError, bitswapBytesMatchHash, hopBitswapCid } from '../rpc/index.js';

const DEFAULT_CHUNK_SIZE = 2_000_000;

// Headroom subtracted from the chunk size for the inline threshold (RFC
// 0001): covers the envelope's version and payload bytes, the compact length
// prefix, and the 28 bytes of ChaCha20-Poly1305 nonce and tag, keeping the
// encrypted entry within the node-side limits already accepted for chunks.
// Normative constant — matches Android's `ENTRY_OVERHEAD_BYTES`.
const INLINE_MARGIN = 64;

function splitIntoChunks(data: Uint8Array, chunkSize: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    chunks.push(data.subarray(offset, offset + chunkSize));
  }
  return chunks;
}

export type UploadParams = {
  data: Uint8Array;
  hopClient: HopClient;
  chunkSize?: number;
  onProgress?: (sent: number, total: number) => void;
};

export type UploadResult = {
  identifier: Uint8Array;
  claimTicket: Uint8Array;
};

export function uploadFile(params: UploadParams): ResultAsync<UploadResult, Error> {
  const { data, hopClient, chunkSize = DEFAULT_CHUNK_SIZE, onProgress } = params;

  const ticket = generateTicket();
  const recipientPublicKey = derivePublicKey(ticket);
  const encryptionKey = deriveEncryptionKey(ticket);
  const encryption = createFileEncryption(encryptionKey);
  const recipients = [recipientPublicKey];

  // The root entry is what the `identifier` names: the hash of its *encrypted*
  // bytes. `steps` is the terminal progress step (the root is always last).
  const submitRoot = (envelope: Uint8Array, steps: number): ResultAsync<UploadResult, Error> => {
    const encrypted = encryption.encrypt(envelope);

    return hopClient.submit(encrypted, recipients).map(_poolStatus => {
      onProgress?.(steps, steps);
      return { identifier: blake2b256(encrypted), claimTicket: ticket };
    });
  };

  // Small files travel inline in the root entry (RFC 0001): one pool entry,
  // one claim on the receiving side, no chunk list.
  if (data.length <= chunkSize - INLINE_MARGIN) {
    return submitRoot(VersionedUploadedFile.enc({ tag: 'v1', value: { tag: 'inline', value: data } }), 1);
  }

  const chunks = splitIntoChunks(data, chunkSize);
  const totalChunks = chunks.length;
  const chunkHashes: Uint8Array[] = [];

  let submitted: ResultAsync<unknown, Error> = okAsync(null);

  for (let i = 0; i < totalChunks; i++) {
    const chunk = chunks[i]!;
    submitted = submitted.andThen(() => {
      const encrypted = encryption.encrypt(chunk);
      return hopClient.submit(encrypted, recipients).map(_poolStatus => {
        chunkHashes.push(blake2b256(encrypted));
        onProgress?.(i + 1, totalChunks + 1); // +1 for the root entry
        return null;
      });
    });
  }

  return submitted.andThen(() =>
    submitRoot(
      VersionedUploadedFile.enc({
        tag: 'v1',
        value: { tag: 'chunked', value: { totalSize: BigInt(data.length), chunks: chunkHashes } },
      }),
      totalChunks + 1,
    ),
  );
}

/**
 * In-call retry policy for the on-chain fallback (RFC 0001). A bitswap
 * `NotFound` may mean the promotion extrinsic is still in flight, so a few
 * bounded attempts with exponential backoff are made before giving up.
 *
 * The RFC's full policy — a 24-hour retry window persisted per entry, with
 * backoff capped at 1 hour and rotation across Bulletin nodes — spans
 * multiple sessions and connections, which a stateless loader over a single
 * connection cannot own. Callers implement the outer window by re-invoking
 * `downloadFile` on their own schedule (cf. Android's HopTransferRetryPolicy).
 */
export type BitswapRetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  /** The RFC's 1-hour ceiling; only binds once a caller raises `maxAttempts`. */
  capDelayMs: number;
};

const DEFAULT_BITSWAP_RETRY: BitswapRetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 10_000,
  capDelayMs: 3_600_000,
};

export type DownloadParams = {
  identifier: Uint8Array;
  claimTicket: Uint8Array;
  hopClient: HopClient;
  onProgress?: (received: number, total: number) => void;
  bitswapRetry?: Partial<BitswapRetryPolicy>;
};

// Sign the canonical claim payload (`blake2b256("hop-claim-v1:" || hash)`)
// instead of the raw hash — the HOP server validates the signature against
// this exact payload, identical to Android's `HopSigningPayloads.claim`.
// Signing the raw hash was the previous behaviour; the server then rejected
// the signature and returned the error as "Data not found", indistinguishable
// from an actually-missing entry.
function signClaimPayload(claimTicket: Uint8Array, hash: Uint8Array): Uint8Array {
  return signWithTicket(claimTicket, HopSigningPayloads.claim(hash));
}

// A claim miss is `hop_claim`'s own NotFound (1004); `bitswap_v1_get` reports
// the same condition under a different number, accepted here too because a
// proxying node may surface either. Older servers stringify the error and lose
// the code entirely, so the message is matched as a last resort.
function isNotFoundError(error: Error): boolean {
  if (error instanceof HopRpcError) {
    return error.code === HopErrorCode.notFound || error.code === BitswapErrorCode.notFound;
  }
  return /not found/i.test(error.message);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * `totalSize` is authenticated (it comes out of the AEAD-sealed root entry) but
 * still sender-authored, so the up-front allocation is guarded rather than
 * trusted: a corrupt value yields an `Err` instead of a thrown `RangeError`.
 */
function allocateFile(totalSize: bigint): Result<Uint8Array, Error> {
  const size = Number(totalSize);
  if (!Number.isSafeInteger(size)) {
    return err(new Error(`Declared file size ${totalSize} is out of range`));
  }
  try {
    return ok(new Uint8Array(size));
  } catch (e) {
    return err(new Error(`Cannot allocate ${totalSize} bytes for the file: ${e}`));
  }
}

// RFC: a rejected CID MUST NOT be retried — it is a client-side encoding bug,
// and no amount of waiting changes the answer.
function isTerminalBitswapError(error: Error): boolean {
  return error instanceof HopRpcError && error.code === BitswapErrorCode.invalidCid;
}

/**
 * Fetch one promoted entry via `bitswap_v1_get` (RFC 0001 on-chain
 * fallback), verifying the returned bytes hash back to the entry hash —
 * the RPC path has no built-in integrity check, so this is the sole
 * integrity boundary.
 *
 * Verification sits outside the retry loop on purpose: this client talks to a
 * single node, so re-asking it for the same CID would return the same bad bytes
 * (the RFC's "treat as NotFound from this node" is only actionable when you can
 * rotate nodes, which the caller owning the outer window can).
 */
function fetchFromChain(
  hash: Uint8Array,
  hopClient: HopClient,
  policy: BitswapRetryPolicy,
): ResultAsync<Uint8Array, Error> {
  const cid = hopBitswapCid(hash);

  const attempt = (n: number): ResultAsync<Uint8Array, Error> =>
    hopClient.bitswapGet(cid).orElse(error => {
      if (isTerminalBitswapError(error)) {
        return errAsync(error);
      }
      if (n >= policy.maxAttempts) {
        return errAsync(new Error(`Entry unavailable on-chain after ${n} attempts: ${error.message}`));
      }
      const backoff = Math.min(policy.capDelayMs, policy.baseDelayMs * 2 ** (n - 1));
      return fromSafePromise(delay(backoff)).andThen(() => attempt(n + 1));
    });

  return attempt(1).andThen(bytes =>
    bitswapBytesMatchHash(bytes, hash)
      ? okAsync(bytes)
      : errAsync(new Error('bitswap bytes failed the blake2b-256 integrity check')),
  );
}

export function downloadFile(params: DownloadParams): ResultAsync<Uint8Array, Error> {
  const { identifier, claimTicket, hopClient, onProgress } = params;
  const retryPolicy: BitswapRetryPolicy = { ...DEFAULT_BITSWAP_RETRY, ...params.bitswapRetry };

  const encryptionKey = deriveEncryptionKey(claimTicket);
  const encryption = createFileEncryption(encryptionKey);

  // Pool first — `hop_claim` MUST always be attempted before the fallback
  // (RFC 0001). Skip ack in both paths: a successful claim already evicts
  // the entry server-side (and firing a fire-and-forget ack on the same WSS
  // during chunk loops can stall the next claim's response — observed in
  // practice), and for chain-sourced entries the pool entry no longer
  // exists. The fallback applies per entry, so one chunked file may mix
  // pool-sourced and chain-sourced chunks (e.g. a resumed download).
  const fetchEntry = (hash: Uint8Array): ResultAsync<Uint8Array, Error> => {
    return hopClient.claim(hash, signClaimPayload(claimTicket, hash)).orElse(error => {
      if (!isNotFoundError(error)) {
        return errAsync(error);
      }
      return fetchFromChain(hash, hopClient, retryPolicy);
    });
  };

  return fetchEntry(identifier)
    .andThen(encryptedRoot => {
      try {
        const rootBytes = encryption.decrypt(encryptedRoot);
        return okAsync(decodeRootEntry(rootBytes));
      } catch (e) {
        return errAsync(new Error(`Failed to decrypt/decode root entry: ${e}`));
      }
    })
    .andThen(rootEntry => {
      if (rootEntry.kind === 'inline') {
        onProgress?.(1, 1);
        return okAsync(rootEntry.fileBytes);
      }

      const { totalSize, chunks: chunkHashes } = rootEntry;
      const totalChunks = chunkHashes.length;

      // Chunks are written straight into the final buffer as they arrive:
      // collecting them first and concatenating at the end would hold two full
      // copies of the file at once, which for a multi-megabyte attachment in a
      // browser tab is the part that hurts. Fetches are sequential, so the
      // running offset is the chunk's position.
      const reassembled = allocateFile(totalSize);
      if (reassembled.isErr()) {
        return errAsync(reassembled.error);
      }
      const file = reassembled.value;
      let offset = 0;

      let received: ResultAsync<unknown, Error> = okAsync(null);

      for (let i = 0; i < totalChunks; i++) {
        const chunkHash = chunkHashes[i]!;
        received = received.andThen(() => {
          return fetchEntry(chunkHash).andThen(encryptedChunk => {
            let chunk: Uint8Array;
            try {
              chunk = encryption.decrypt(encryptedChunk);
            } catch (e) {
              return errAsync(new Error(`Failed to decrypt chunk ${i}: ${e}`));
            }
            if (offset + chunk.length > file.length) {
              return errAsync(new Error(`File size mismatch: chunks exceed the declared ${totalSize} bytes`));
            }
            file.set(chunk, offset);
            offset += chunk.length;
            onProgress?.(i + 1, totalChunks);
            return okAsync(null);
          });
        });
      }

      return received.andThen(() => {
        if (offset !== file.length) {
          return errAsync(new Error(`File size mismatch: expected ${totalSize}, got ${offset}`));
        }
        return okAsync(file);
      });
    });
}
