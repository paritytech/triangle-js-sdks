import { describe, expect, it } from 'vitest';

import { FixedSizeChunker, reassembleChunks } from '../src/chunker.js';

describe('Chunker', () => {
  it('should chunk data correctly with default config', () => {
    const data = new Uint8Array(5 * 1024 * 1024).fill(0xaa); // 5 MiB
    const config = { chunkSize: 1024 * 1024, createManifest: true };

    const chunker = new FixedSizeChunker(config);
    const chunks = chunker.chunk(data)._unsafeUnwrap();

    expect(chunks).toHaveLength(5);

    chunks.forEach((chunk, i) => {
      expect(chunk.data).toHaveLength(1024 * 1024);
      expect(chunk.index).toBe(i);
      expect(chunk.totalChunks).toBe(5);
    });
  });

  it('should handle data smaller than chunk size', () => {
    const data = new Uint8Array(512 * 1024).fill(0xbb); // 512 KiB
    const chunker = new FixedSizeChunker({ chunkSize: 1024 * 1024, createManifest: true });
    const chunks = chunker.chunk(data)._unsafeUnwrap();

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.data).toHaveLength(512 * 1024);
    expect(chunks[0]!.index).toBe(0);
    expect(chunks[0]!.totalChunks).toBe(1);
  });

  it('should handle data with partial last chunk', () => {
    const data = new Uint8Array(2.5 * 1024 * 1024).fill(0xcc); // 2.5 MiB
    const chunker = new FixedSizeChunker({ chunkSize: 1024 * 1024, createManifest: true });
    const chunks = chunker.chunk(data)._unsafeUnwrap();

    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.data).toHaveLength(1024 * 1024);
    expect(chunks[1]!.data).toHaveLength(1024 * 1024);
    expect(chunks[2]!.data).toHaveLength(0.5 * 1024 * 1024);
  });

  it('should calculate total chunks correctly', () => {
    const chunker = new FixedSizeChunker({ chunkSize: 1024 * 1024, createManifest: true });

    expect(chunker.numChunks(1024 * 1024)).toBe(1);
    expect(chunker.numChunks(5 * 1024 * 1024)).toBe(5);
    expect(chunker.numChunks(2.5 * 1024 * 1024)).toBe(3);
    expect(chunker.numChunks(0)).toBe(0);
  });

  it('should throw error for chunk size exceeding maximum', () => {
    expect(() => new FixedSizeChunker({ chunkSize: 10 * 1024 * 1024, createManifest: true })).toThrow();
  });

  it('should calculate chunks correctly for 64 MiB file', () => {
    const chunker = new FixedSizeChunker({ chunkSize: 2 * 1024 * 1024, createManifest: true });
    expect(chunker.numChunks(64 * 1024 * 1024)).toBe(32);
    expect(chunker.chunkSize).toBe(2 * 1024 * 1024);
  });

  it('should throw error for zero chunk size', () => {
    expect(() => new FixedSizeChunker({ chunkSize: 0, createManifest: true })).toThrow();
  });

  it('should validate chunk data integrity', () => {
    const data = new Uint8Array(3 * 1024 * 1024);
    for (let i = 0; i < data.length; i++) {
      data[i] = i % 256;
    }

    const chunker = new FixedSizeChunker({ chunkSize: 1024 * 1024, createManifest: true });
    const chunks = chunker.chunk(data)._unsafeUnwrap();
    const reassembled = reassembleChunks(chunks)._unsafeUnwrap();
    expect(reassembled).toEqual(data);
  });

  it('should return err on missing chunk index during reassembly', () => {
    const chunks = [
      { data: new Uint8Array([1]), index: 0, totalChunks: 3 },
      { data: new Uint8Array([3]), index: 2, totalChunks: 3 },
    ];
    const result = reassembleChunks(chunks);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Missing chunk at index 1');
  });
});
