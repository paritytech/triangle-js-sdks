import { describe, expect, it } from 'vitest';

import { UploadedFile, VersionedUploadedFile, decodeRootEntry } from './codec.js';

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

describe('VersionedUploadedFile codec (RFC 0001)', () => {
  it('uses the normative enum indices: v1 -> 0, inline -> 0, chunked -> 1', () => {
    const inline = VersionedUploadedFile.enc({ tag: 'v1', value: { tag: 'inline', value: new Uint8Array([7]) } });
    expect(inline[0]).toBe(0); // version index
    expect(inline[1]).toBe(0); // payload index
    const chunked = VersionedUploadedFile.enc({
      tag: 'v1',
      value: { tag: 'chunked', value: { totalSize: 1n, chunks: [] } },
    });
    expect(chunked[0]).toBe(0);
    expect(chunked[1]).toBe(1);
  });

  it('chunked payload is byte-for-byte the legacy layout after the two envelope bytes', () => {
    const hash = new Uint8Array(32).fill(0xaa);
    const legacy = UploadedFile.enc({ totalSize: 4_000_000n, chunks: [hash] });
    const envelope = VersionedUploadedFile.enc({
      tag: 'v1',
      value: { tag: 'chunked', value: { totalSize: 4_000_000n, chunks: [hash] } },
    });
    expect(envelope.length).toBe(legacy.length + 2);
    expect(Array.from(envelope.subarray(2))).toEqual(Array.from(legacy));
  });

  it('decodeRootEntry decodes inline and chunked envelopes', () => {
    const file = new Uint8Array([1, 2, 3, 4]);
    const inline = decodeRootEntry(VersionedUploadedFile.enc({ tag: 'v1', value: { tag: 'inline', value: file } }));
    expect(inline).toEqual({ kind: 'inline', fileBytes: file });

    const hash = new Uint8Array(32).fill(0xbb);
    const chunked = decodeRootEntry(
      VersionedUploadedFile.enc({ tag: 'v1', value: { tag: 'chunked', value: { totalSize: 9n, chunks: [hash] } } }),
    );
    expect(chunked.kind).toBe('chunked');
    if (chunked.kind === 'chunked') {
      expect(chunked.totalSize).toBe(9n);
      expect(chunked.chunks).toEqual([hash]);
    }
  });

  it('decodeRootEntry falls back to the bare legacy layout', () => {
    const hash = new Uint8Array(32).fill(0xcc);
    const legacy = UploadedFile.enc({ totalSize: 123n, chunks: [hash] });
    const decoded = decodeRootEntry(legacy);
    expect(decoded.kind).toBe('chunked');
    if (decoded.kind === 'chunked') {
      expect(decoded.totalSize).toBe(123n);
      expect(decoded.chunks).toEqual([hash]);
    }
  });
});
