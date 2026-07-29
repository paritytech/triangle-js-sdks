import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';

import { createEncryption } from './encyption.js';

const deriveAeadKey = (sharedSecret: Uint8Array) => hkdf(sha256, sharedSecret, new Uint8Array(), new Uint8Array(), 32);

describe('statement-store message encryption', () => {
  it('round-trips a message', () => {
    const sharedSecret = randomBytes(32);
    const encryption = createEncryption(sharedSecret);
    const plaintext = new TextEncoder().encode('hello statement');

    const encrypted = encryption.encrypt(plaintext)._unsafeUnwrap();
    const decrypted = encryption.decrypt(encrypted)._unsafeUnwrap();

    expect(decrypted).toEqual(plaintext);
  });

  it('produces ChaCha20-Poly1305 ciphertext decryptable by an external ChaCha20-Poly1305 reader', () => {
    const sharedSecret = randomBytes(32);
    const plaintext = new TextEncoder().encode('cross-decrypt me');

    const encrypted = createEncryption(sharedSecret).encrypt(plaintext)._unsafeUnwrap();

    const nonce = encrypted.slice(0, 12);
    const body = encrypted.slice(12);
    const aeadKey = deriveAeadKey(sharedSecret);
    const decrypted = chacha20poly1305(aeadKey, nonce).decrypt(body);

    expect(decrypted).toEqual(plaintext);
  });

  it('decrypts a ChaCha20-Poly1305 ciphertext built externally (nonce || ct || tag framing)', () => {
    const sharedSecret = randomBytes(32);
    const plaintext = new TextEncoder().encode('external chacha');
    const aeadKey = deriveAeadKey(sharedSecret);
    const nonce = randomBytes(12);
    const body = chacha20poly1305(aeadKey, nonce).encrypt(plaintext);
    const wire = new Uint8Array([...nonce, ...body]);

    const decrypted = createEncryption(sharedSecret).decrypt(wire)._unsafeUnwrap();

    expect(decrypted).toEqual(plaintext);
  });

  it('fails to decrypt with a different shared secret', () => {
    const plaintext = new TextEncoder().encode('secret');
    const encrypted = createEncryption(randomBytes(32)).encrypt(plaintext)._unsafeUnwrap();

    const result = createEncryption(randomBytes(32)).decrypt(encrypted);

    expect(result.isErr()).toBe(true);
  });
});
