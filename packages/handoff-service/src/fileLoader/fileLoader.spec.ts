import { randomBytes } from '@noble/hashes/utils.js';
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { UploadedFile } from '../codec.js';
import {
  blake2b256,
  createFileEncryption,
  deriveEncryptionKey,
  derivePublicKey,
  generateTicket,
} from '../crypto/index.js';
import type { HopClient } from '../rpc/index.js';
import { BitswapErrorCode, HopErrorCode, HopRpcError, hopBitswapCid } from '../rpc/index.js';

import { downloadFile, uploadFile } from './fileLoader.js';

// Retry policy for tests: real backoff would sleep 10s between attempts.
const FAST_RETRY = { maxAttempts: 2, baseDelayMs: 1, capDelayMs: 2 };

function createMockHopClient() {
  const submittedEntries = new Map<string, Uint8Array>();
  // Entries "promoted" to on-chain storage, keyed by bitswap CID.
  const chainEntries = new Map<string, Uint8Array>();

  function hashKey(hash: Uint8Array): string {
    return Array.from(hash)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  const submitMock = vi.fn();
  const claimMock = vi.fn();
  const bitswapMock = vi.fn();

  submitMock.mockImplementation((data: Uint8Array, _recipients: Uint8Array[]) => {
    const h = blake2b256(data);
    submittedEntries.set(hashKey(h), new Uint8Array(data));
    return okAsync({ entryCount: submittedEntries.size, totalBytes: 0, maxBytes: 10_000_000 });
  });

  claimMock.mockImplementation((hash: Uint8Array, _signature: Uint8Array) => {
    const key = hashKey(hash);
    const entry = submittedEntries.get(key);
    if (!entry) {
      return errAsync(new HopRpcError('Data not found', HopErrorCode.notFound));
    }
    submittedEntries.delete(key);
    return okAsync(entry);
  });

  bitswapMock.mockImplementation((cid: string) => {
    const entry = chainEntries.get(cid);
    if (!entry) {
      return errAsync(new HopRpcError('NotFound', BitswapErrorCode.notFound));
    }
    return okAsync(entry);
  });

  /** Simulate HOP retention expiry: move a pool entry to on-chain storage. */
  function promoteEntry(hash: Uint8Array): void {
    const key = hashKey(hash);
    const entry = submittedEntries.get(key);
    if (!entry) throw new Error(`nothing to promote for ${key}`);
    submittedEntries.delete(key);
    chainEntries.set(hopBitswapCid(hash), entry);
  }

  const ackMock = vi.fn(() => okAsync(null));

  const client: HopClient = {
    submit: submitMock,
    claim: claimMock,
    ack: ackMock,
    poolStatus: vi.fn(() => okAsync({ entryCount: 0, totalBytes: 0, maxBytes: 10_000_000 })),
    bitswapGet: bitswapMock,
  };

  return { client, submitMock, claimMock, ackMock, bitswapMock, submittedEntries, chainEntries, promoteEntry };
}

describe('file loader', () => {
  it('uploads and downloads a small file (single chunk)', async () => {
    const { client } = createMockHopClient();
    const data = new TextEncoder().encode('hello world');

    const uploadResult = await uploadFile({ data, hopClient: client });
    await expect(uploadResult).toBeOk();

    const { identifier, claimTicket } = uploadResult._unsafeUnwrap();
    expect(identifier.length).toBe(32);
    expect(claimTicket.length).toBe(32);

    const downloadResult = await downloadFile({
      identifier,
      claimTicket,
      hopClient: client,
    });

    await expect(downloadResult).toBeOkWith(data);
  });

  it('uploads and downloads a multi-chunk file', async () => {
    const { client } = createMockHopClient();
    const data = randomBytes(5_000);

    const uploadResult = await uploadFile({
      data,
      hopClient: client,
      chunkSize: 2_000,
    });
    await expect(uploadResult).toBeOk();

    const { identifier, claimTicket } = uploadResult._unsafeUnwrap();

    const downloadResult = await downloadFile({
      identifier,
      claimTicket,
      hopClient: client,
    });

    await expect(downloadResult).toBeOkWith(data);
  });

  it('reports upload progress', async () => {
    const { client } = createMockHopClient();
    const data = randomBytes(5_000);
    const progress: [number, number][] = [];

    await uploadFile({
      data,
      hopClient: client,
      chunkSize: 2_000,
      onProgress: (sent, total) => progress.push([sent, total]),
    });

    // 3 chunks + 1 metadata = total 4 steps
    expect(progress).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
  });

  it('reports download progress', async () => {
    const { client } = createMockHopClient();
    const data = randomBytes(5_000);

    const { identifier, claimTicket } = (
      await uploadFile({ data, hopClient: client, chunkSize: 2_000 })
    )._unsafeUnwrap();

    const progress: [number, number][] = [];
    await downloadFile({
      identifier,
      claimTicket,
      hopClient: client,
      onProgress: (received, total) => progress.push([received, total]),
    });

    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('handles empty file', async () => {
    const { client } = createMockHopClient();
    const data = new Uint8Array(0);

    const uploadResult = await uploadFile({ data, hopClient: client });
    await expect(uploadResult).toBeOk();

    const { identifier, claimTicket } = uploadResult._unsafeUnwrap();
    const downloadResult = await downloadFile({
      identifier,
      claimTicket,
      hopClient: client,
    });

    await expect(downloadResult).toBeOkWith(data);
  });
});

describe('inline root entries (RFC 0001)', () => {
  it('small files travel as a single pool entry', async () => {
    const { client, submitMock } = createMockHopClient();
    const data = randomBytes(1_000);

    const { identifier, claimTicket } = (await uploadFile({ data, hopClient: client }))._unsafeUnwrap();
    expect(submitMock).toHaveBeenCalledTimes(1);

    const downloadResult = await downloadFile({ identifier, claimTicket, hopClient: client });
    await expect(downloadResult).toBeOkWith(data);
  });

  it('files above the inline threshold still use the chunked flow', async () => {
    const { client, submitMock } = createMockHopClient();
    const data = randomBytes(2_000);

    const { identifier, claimTicket } = (
      await uploadFile({ data, hopClient: client, chunkSize: 2_000 })
    )._unsafeUnwrap();
    // 2000 > 2000 - 64, so: 1 chunk + 1 root entry
    expect(submitMock).toHaveBeenCalledTimes(2);

    const downloadResult = await downloadFile({ identifier, claimTicket, hopClient: client });
    await expect(downloadResult).toBeOkWith(data);
  });

  it('reports 1/1 progress for an inline download', async () => {
    const { client } = createMockHopClient();
    const data = randomBytes(100);
    const { identifier, claimTicket } = (await uploadFile({ data, hopClient: client }))._unsafeUnwrap();

    const progress: [number, number][] = [];
    await downloadFile({
      identifier,
      claimTicket,
      hopClient: client,
      onProgress: (received, total) => progress.push([received, total]),
    });
    expect(progress).toEqual([[1, 1]]);
  });
});

describe('on-chain fallback (RFC 0001)', () => {
  it('recovers an inline root entry promoted out of the pool', async () => {
    const { client, promoteEntry, claimMock, bitswapMock, ackMock } = createMockHopClient();
    const data = randomBytes(1_000);
    const { identifier, claimTicket } = (await uploadFile({ data, hopClient: client }))._unsafeUnwrap();

    promoteEntry(identifier);

    const downloadResult = await downloadFile({ identifier, claimTicket, hopClient: client });
    await expect(downloadResult).toBeOkWith(data);

    // hop_claim attempted first, then the fallback; chain-sourced entries are not acked.
    expect(claimMock).toHaveBeenCalledTimes(1);
    expect(bitswapMock).toHaveBeenCalledTimes(1);
    expect(ackMock).not.toHaveBeenCalled();
  });

  it('mixes pool-sourced and chain-sourced chunks in one download', async () => {
    const { client, promoteEntry, bitswapMock } = createMockHopClient();
    const data = randomBytes(5_000);

    const { identifier, claimTicket } = (
      await uploadFile({ data, hopClient: client, chunkSize: 2_000 })
    )._unsafeUnwrap();

    // Promote only the root entry and leave the chunks in the pool.
    promoteEntry(identifier);

    const downloadResult = await downloadFile({ identifier, claimTicket, hopClient: client });
    await expect(downloadResult).toBeOkWith(data);
    expect(bitswapMock).toHaveBeenCalledTimes(1);
  });

  it('rejects tampered bitswap bytes without retrying the same node', async () => {
    const { client, promoteEntry, chainEntries, bitswapMock } = createMockHopClient();
    const data = randomBytes(500);
    const { identifier, claimTicket } = (await uploadFile({ data, hopClient: client }))._unsafeUnwrap();

    promoteEntry(identifier);
    // Substitute the promoted bytes: same CID key, different content.
    const [cid] = [...chainEntries.keys()];
    chainEntries.set(cid!, randomBytes(500));

    const downloadResult = await downloadFile({
      identifier,
      claimTicket,
      hopClient: client,
      bitswapRetry: FAST_RETRY,
    });
    expect(downloadResult.isErr()).toBe(true);
    expect(downloadResult._unsafeUnwrapErr().message).toMatch(/integrity check/);
    // Re-asking the same node for the same CID cannot produce different bytes.
    expect(bitswapMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the node rejects the CID', async () => {
    const { client, bitswapMock, submittedEntries } = createMockHopClient();
    const data = randomBytes(500);
    const { identifier, claimTicket } = (await uploadFile({ data, hopClient: client }))._unsafeUnwrap();

    submittedEntries.clear();
    bitswapMock.mockImplementation(() => errAsync(new HopRpcError('invalid CID', BitswapErrorCode.invalidCid)));

    const downloadResult = await downloadFile({
      identifier,
      claimTicket,
      hopClient: client,
      bitswapRetry: FAST_RETRY,
    });
    expect(downloadResult.isErr()).toBe(true);
    expect(bitswapMock).toHaveBeenCalledTimes(1);
  });

  it('does not fall back when the claim fails for a non-NotFound reason', async () => {
    const { client, claimMock, bitswapMock } = createMockHopClient();
    const data = randomBytes(500);
    const { identifier, claimTicket } = (await uploadFile({ data, hopClient: client }))._unsafeUnwrap();

    claimMock.mockImplementation(() => errAsync(new HopRpcError('Bad signature', -32000)));

    const downloadResult = await downloadFile({ identifier, claimTicket, hopClient: client });
    expect(downloadResult.isErr()).toBe(true);
    expect(bitswapMock).not.toHaveBeenCalled();
  });

  it('falls back when an older server stringifies the claim error and loses the code', async () => {
    const { client, promoteEntry, claimMock, bitswapMock } = createMockHopClient();
    const data = randomBytes(500);
    const { identifier, claimTicket } = (await uploadFile({ data, hopClient: client }))._unsafeUnwrap();

    promoteEntry(identifier);
    claimMock.mockImplementation(() => errAsync(new Error('Data not found')));

    const downloadResult = await downloadFile({ identifier, claimTicket, hopClient: client });
    await expect(downloadResult).toBeOkWith(data);
    expect(bitswapMock).toHaveBeenCalledTimes(1);
  });

  it('fails with a bounded error when the entry is nowhere', async () => {
    const { client, submittedEntries, bitswapMock } = createMockHopClient();
    const data = randomBytes(500);
    const { identifier, claimTicket } = (await uploadFile({ data, hopClient: client }))._unsafeUnwrap();

    submittedEntries.clear(); // expired but never promoted

    const downloadResult = await downloadFile({
      identifier,
      claimTicket,
      hopClient: client,
      bitswapRetry: FAST_RETRY,
    });
    expect(downloadResult.isErr()).toBe(true);
    expect(downloadResult._unsafeUnwrapErr().message).toMatch(/after 2 attempts/);
    expect(bitswapMock).toHaveBeenCalledTimes(FAST_RETRY.maxAttempts);
  });
});

describe('legacy compatibility (pre RFC 0001)', () => {
  it('downloads a root entry stored in the bare legacy layout', async () => {
    const { client } = createMockHopClient();
    const data = randomBytes(3_000);

    // Hand-roll a legacy upload: chunks + bare (unversioned) UploadedFile root.
    const ticket = generateTicket();
    const encryption = createFileEncryption(deriveEncryptionKey(ticket));
    const recipients = [derivePublicKey(ticket)];

    const chunkHashes: Uint8Array[] = [];
    for (let offset = 0; offset < data.length; offset += 2_000) {
      const encrypted = encryption.encrypt(data.subarray(offset, offset + 2_000));
      await client.submit(encrypted, recipients);
      chunkHashes.push(blake2b256(encrypted));
    }
    const legacyRoot = encryption.encrypt(UploadedFile.enc({ totalSize: BigInt(data.length), chunks: chunkHashes }));
    await client.submit(legacyRoot, recipients);

    const downloadResult = await downloadFile({
      identifier: blake2b256(legacyRoot),
      claimTicket: ticket,
      hopClient: client,
    });
    await expect(downloadResult).toBeOkWith(data);
  });
});
