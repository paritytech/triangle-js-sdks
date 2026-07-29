import { describe, expect, it } from 'vitest';

import type { EncrPublicKey, EncrSecret } from './crypto.js';
import { createSharedSecret, getEncrPub } from './crypto.js';

// RFC 7748 §5.2 X25519 test vector.
const fromHex = (hex: string): Uint8Array => Uint8Array.from(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));

const ALICE_PRIVATE = '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a';
const ALICE_PUBLIC = '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a';
const BOB_PRIVATE = '5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb';
const BOB_PUBLIC = 'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f';
const SHARED_SECRET = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742';

const asSecret = (hex: string) => fromHex(hex) as EncrSecret;

describe('X25519 encryption keys', () => {
  it('derives a 32-byte X25519 public key from a private scalar (RFC 7748 vector)', () => {
    const publicKey = getEncrPub(asSecret(ALICE_PRIVATE));

    expect(publicKey.length).toBe(32);
    expect(publicKey).toEqual(fromHex(ALICE_PUBLIC));
  });

  it('computes the RFC 7748 shared secret whole, without slicing', () => {
    const shared = createSharedSecret(asSecret(ALICE_PRIVATE), fromHex(BOB_PUBLIC));

    expect(shared.length).toBe(32);
    expect(shared).toEqual(fromHex(SHARED_SECRET));
  });

  it('agrees on the same shared secret from either side', () => {
    const fromAlice = createSharedSecret(asSecret(ALICE_PRIVATE), fromHex(BOB_PUBLIC));
    const fromBob = createSharedSecret(asSecret(BOB_PRIVATE), fromHex(ALICE_PUBLIC));

    expect(fromAlice).toEqual(fromBob);
  });

  it('rejects a small-order public key (all-zero shared secret)', () => {
    const smallOrderPoint = new Uint8Array(32) as EncrPublicKey;

    expect(() => createSharedSecret(asSecret(ALICE_PRIVATE), smallOrderPoint)).toThrow();
  });
});
