import { randomBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';

import { createFileEncryption } from './encryption.js';

describe('file encryption', () => {
  it('encrypts and decrypts data', () => {
    const key = randomBytes(32);
    const encryption = createFileEncryption(key);
    const plaintext = new TextEncoder().encode('hello world');

    const encrypted = encryption.encrypt(plaintext);
    const decrypted = encryption.decrypt(encrypted);

    expect(decrypted).toEqual(plaintext);
  });

  it('encrypted data is longer than plaintext (nonce + tag)', () => {
    const key = randomBytes(32);
    const encryption = createFileEncryption(key);
    const plaintext = new Uint8Array(100);

    const encrypted = encryption.encrypt(plaintext);
    // 12 bytes nonce + 100 bytes ciphertext + 16 bytes tag = 128
    expect(encrypted.length).toBe(100 + 12 + 16);
  });

  it('produces different ciphertext for same plaintext (random nonce)', () => {
    const key = randomBytes(32);
    const encryption = createFileEncryption(key);
    const plaintext = new Uint8Array([1, 2, 3]);

    const a = encryption.encrypt(plaintext);
    const b = encryption.encrypt(plaintext);

    expect(a).not.toEqual(b);
  });

  it('fails to decrypt with wrong key', () => {
    const key1 = randomBytes(32);
    const key2 = randomBytes(32);
    const enc1 = createFileEncryption(key1);
    const enc2 = createFileEncryption(key2);

    const plaintext = new TextEncoder().encode('secret');
    const encrypted = enc1.encrypt(plaintext);

    expect(() => enc2.decrypt(encrypted)).toThrow();
  });

  it('handles empty data', () => {
    const key = randomBytes(32);
    const encryption = createFileEncryption(key);
    const plaintext = new Uint8Array(0);

    const encrypted = encryption.encrypt(plaintext);
    const decrypted = encryption.decrypt(encrypted);

    expect(decrypted).toEqual(plaintext);
  });

  it('handles large data', () => {
    const key = randomBytes(32);
    const encryption = createFileEncryption(key);
    const plaintext = new Uint8Array(50_000).fill(0x42);

    const encrypted = encryption.encrypt(plaintext);
    const decrypted = encryption.decrypt(encrypted);

    expect(decrypted).toEqual(plaintext);
  });
});
