import { blake2b } from '@noble/hashes/blake2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { okAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { HopClient } from '../rpc/index.js';

import { downloadFile, uploadFile } from './fileLoader.js';

function hash256(data: Uint8Array): Uint8Array {
  return blake2b(data, { dkLen: 32 });
}

function createMockHopClient() {
  const submittedEntries = new Map<string, Uint8Array>();

  function hashKey(hash: Uint8Array): string {
    return Array.from(hash)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  const submitMock = vi.fn();
  const claimMock = vi.fn();

  submitMock.mockImplementation((data: Uint8Array, _recipients: Uint8Array[]) => {
    const h = hash256(data);
    submittedEntries.set(hashKey(h), new Uint8Array(data));
    return okAsync({ entryCount: submittedEntries.size, totalBytes: 0, maxBytes: 10_000_000 });
  });

  claimMock.mockImplementation((hash: Uint8Array, _signature: Uint8Array) => {
    const key = hashKey(hash);
    const entry = submittedEntries.get(key);
    if (!entry) {
      throw new Error(`No entry for hash ${key}`);
    }
    submittedEntries.delete(key);
    return okAsync(entry);
  });

  const client: HopClient = {
    submit: submitMock,
    claim: claimMock,
    ack: vi.fn(() => okAsync(null)),
    poolStatus: vi.fn(() => okAsync({ entryCount: 0, totalBytes: 0, maxBytes: 10_000_000 })),
  };

  return { client, submitMock, claimMock, submittedEntries };
}

describe('file loader', () => {
  it('uploads and downloads a small file (single chunk)', async () => {
    const { client } = createMockHopClient();
    const data = new TextEncoder().encode('hello world');

    const uploadResult = await uploadFile({ data, hopClient: client });
    expect(uploadResult.isOk()).toBe(true);

    const { identifier, claimTicket } = uploadResult._unsafeUnwrap();
    expect(identifier.length).toBe(32);
    expect(claimTicket.length).toBe(32);

    const downloadResult = await downloadFile({
      identifier,
      claimTicket,
      hopClient: client,
    });

    expect(downloadResult.isOk()).toBe(true);
    expect(downloadResult._unsafeUnwrap()).toEqual(data);
  });

  it('uploads and downloads a multi-chunk file', async () => {
    const { client } = createMockHopClient();
    const data = randomBytes(5_000);

    const uploadResult = await uploadFile({
      data,
      hopClient: client,
      chunkSize: 2_000,
    });
    expect(uploadResult.isOk()).toBe(true);

    const { identifier, claimTicket } = uploadResult._unsafeUnwrap();

    const downloadResult = await downloadFile({
      identifier,
      claimTicket,
      hopClient: client,
    });

    expect(downloadResult.isOk()).toBe(true);
    expect(downloadResult._unsafeUnwrap()).toEqual(data);
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
    expect(uploadResult.isOk()).toBe(true);

    const { identifier, claimTicket } = uploadResult._unsafeUnwrap();
    const downloadResult = await downloadFile({
      identifier,
      claimTicket,
      hopClient: client,
    });

    expect(downloadResult.isOk()).toBe(true);
    expect(downloadResult._unsafeUnwrap()).toEqual(data);
  });
});
