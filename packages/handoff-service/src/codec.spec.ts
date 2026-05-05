import { describe, expect, it } from 'vitest';

import { UploadedFile } from './codec.js';

describe('UploadedFile codec', () => {
  it('encodes and decodes round-trip', () => {
    const hash1 = new Uint8Array(32).fill(0xaa);
    const hash2 = new Uint8Array(32).fill(0xbb);

    const original = {
      totalSize: 4_000_000n,
      chunks: [hash1, hash2],
    };

    const encoded = UploadedFile.enc(original);
    const decoded = UploadedFile.dec(encoded);

    expect(decoded.totalSize).toBe(4_000_000n);
    expect(decoded.chunks).toHaveLength(2);
    expect(decoded.chunks[0]).toEqual(hash1);
    expect(decoded.chunks[1]).toEqual(hash2);
  });

  it('handles single chunk', () => {
    const hash = new Uint8Array(32).fill(0xcc);
    const original = { totalSize: 100n, chunks: [hash] };

    const encoded = UploadedFile.enc(original);
    const decoded = UploadedFile.dec(encoded);

    expect(decoded.totalSize).toBe(100n);
    expect(decoded.chunks).toHaveLength(1);
  });

  it('handles many chunks', () => {
    const chunks = Array.from({ length: 50 }, (_, i) => new Uint8Array(32).fill(i));
    const original = { totalSize: 100_000_000n, chunks };

    const encoded = UploadedFile.enc(original);
    const decoded = UploadedFile.dec(encoded);

    expect(decoded.totalSize).toBe(100_000_000n);
    expect(decoded.chunks).toHaveLength(50);
  });
});
