import { deriveProductEntropy, deriveProductEntropyFromSource } from '@novasamatech/host-container';

import { blake2b } from '@noble/hashes/blake2.js';
import { describe, expect, it } from 'vitest';

const textEncoder = new TextEncoder();

function blake2b256Keyed(message: Uint8Array, key: Uint8Array): Uint8Array {
  return blake2b(message, { dkLen: 32, key });
}

function blake2b256(message: Uint8Array): Uint8Array {
  return blake2b(message, { dkLen: 32 });
}

describe('deriveProductEntropy', () => {
  const rootSecret = new Uint8Array(16).fill(0xab);
  const productId = 'my-product.dot';
  const key = new Uint8Array([1, 2, 3]);

  it('should return 32 bytes', () => {
    const result = deriveProductEntropy(rootSecret, productId, key);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(32);
  });

  it('should be deterministic — same inputs always produce the same output', () => {
    const a = deriveProductEntropy(rootSecret, productId, key);
    const b = deriveProductEntropy(rootSecret, productId, key);
    expect(a).toEqual(b);
  });

  it('should produce different entropy for different keys', () => {
    const a = deriveProductEntropy(rootSecret, productId, new Uint8Array([1]));
    const b = deriveProductEntropy(rootSecret, productId, new Uint8Array([2]));
    expect(a).not.toEqual(b);
  });

  it('should produce different entropy for different product ids', () => {
    const a = deriveProductEntropy(rootSecret, 'product-a', key);
    const b = deriveProductEntropy(rootSecret, 'product-b', key);
    expect(a).not.toEqual(b);
  });

  it('should produce different entropy for different root secrets', () => {
    const secretA = new Uint8Array(16).fill(0x01);
    const secretB = new Uint8Array(16).fill(0x02);
    const a = deriveProductEntropy(secretA, productId, key);
    const b = deriveProductEntropy(secretB, productId, key);
    expect(a).not.toEqual(b);
  });

  it('should match the RFC-0007 three-layer derivation', () => {
    const domainSeparator = textEncoder.encode('product-entropy-derivation');

    const rootEntropySource = blake2b256Keyed(rootSecret, domainSeparator);
    const perProductEntropy = blake2b256Keyed(rootEntropySource, blake2b256(textEncoder.encode(productId)));
    const expectedEntropy = blake2b256Keyed(perProductEntropy, key);

    const result = deriveProductEntropy(rootSecret, productId, key);
    expect(result).toEqual(expectedEntropy);
  });

  it('should throw if key is bigger than 32 bytes', () => {
    const oversizedKey = new Uint8Array(33).fill(0x01);
    expect(() => deriveProductEntropy(rootSecret, productId, oversizedKey)).toThrow();
  });

  it('should work with a 1-byte key', () => {
    const result = deriveProductEntropy(rootSecret, productId, new Uint8Array([0x42]));
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(32);
  });

  it('should work with a 32-byte key', () => {
    const maxKey = new Uint8Array(32).fill(0xff);
    const result = deriveProductEntropy(rootSecret, productId, maxKey);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(32);
  });
});

describe('deriveProductEntropyFromSource', () => {
  const rootSecret = new Uint8Array(16).fill(0xab);
  const rootEntropySource = blake2b256Keyed(rootSecret, textEncoder.encode('product-entropy-derivation'));
  const productId = 'my-product.dot';
  const key = new Uint8Array([1, 2, 3]);

  it('should match the last two layers of the RFC-0007 derivation', () => {
    const perProductEntropy = blake2b256Keyed(rootEntropySource, blake2b256(textEncoder.encode(productId)));
    const expectedEntropy = blake2b256Keyed(perProductEntropy, key);

    expect(deriveProductEntropyFromSource(rootEntropySource, productId, key)).toEqual(expectedEntropy);
  });

  it('should produce the same entropy as deriveProductEntropy given the corresponding rootAccountSecret', () => {
    // The cross-host determinism invariant: a host that only holds `rootEntropySource`
    // (received over the SSO handshake) derives the same bytes as a wallet that holds
    // the raw `rootAccountSecret`.
    for (const id of ['my-product.dot', 'other.product.dot', 'localhost:3000']) {
      for (const k of [new Uint8Array([0x42]), new Uint8Array(32).fill(0xff)]) {
        expect(deriveProductEntropyFromSource(rootEntropySource, id, k)).toEqual(
          deriveProductEntropy(rootSecret, id, k),
        );
      }
    }
  });

  it('should produce different entropy for different sources, product ids, and keys', () => {
    const otherSource = blake2b256Keyed(
      new Uint8Array(16).fill(0xcd),
      textEncoder.encode('product-entropy-derivation'),
    );
    expect(deriveProductEntropyFromSource(rootEntropySource, productId, key)).not.toEqual(
      deriveProductEntropyFromSource(otherSource, productId, key),
    );
    expect(deriveProductEntropyFromSource(rootEntropySource, 'product-a', key)).not.toEqual(
      deriveProductEntropyFromSource(rootEntropySource, 'product-b', key),
    );
    expect(deriveProductEntropyFromSource(rootEntropySource, productId, new Uint8Array([1]))).not.toEqual(
      deriveProductEntropyFromSource(rootEntropySource, productId, new Uint8Array([2])),
    );
  });

  it('should reject an empty key and a key bigger than 32 bytes', () => {
    expect(() => deriveProductEntropyFromSource(rootEntropySource, productId, new Uint8Array(0))).toThrow();
    expect(() => deriveProductEntropyFromSource(rootEntropySource, productId, new Uint8Array(33).fill(0x01))).toThrow();
  });
});
