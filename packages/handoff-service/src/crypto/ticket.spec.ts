import { describe, expect, it } from 'vitest';

import {
  deriveEncryptionKey,
  derivePublicKey,
  deriveSigningKeypair,
  deriveSigningSeed,
  generateTicket,
  signWithTicket,
} from './ticket.js';

describe('ticket key derivation', () => {
  it('generates a 32-byte ticket', () => {
    const ticket = generateTicket();
    expect(ticket).toBeInstanceOf(Uint8Array);
    expect(ticket.length).toBe(32);
  });

  it('generates unique tickets', () => {
    const a = generateTicket();
    const b = generateTicket();
    expect(a).not.toEqual(b);
  });

  it('derives deterministic signing seed from ticket', () => {
    const ticket = generateTicket();
    const seed1 = deriveSigningSeed(ticket);
    const seed2 = deriveSigningSeed(ticket);
    expect(seed1).toEqual(seed2);
    expect(seed1.length).toBe(32);
  });

  it('derives deterministic signing keypair from ticket', () => {
    const ticket = generateTicket();
    const kp1 = deriveSigningKeypair(ticket);
    const kp2 = deriveSigningKeypair(ticket);
    expect(kp1).toEqual(kp2);
    expect(kp1.length).toBe(64); // sr25519 secret is 64 bytes
  });

  it('derives deterministic public key from ticket', () => {
    const ticket = generateTicket();
    const pk1 = derivePublicKey(ticket);
    const pk2 = derivePublicKey(ticket);
    expect(pk1).toEqual(pk2);
    expect(pk1.length).toBe(32);
  });

  it('derives deterministic encryption key from ticket', () => {
    const ticket = generateTicket();
    const key1 = deriveEncryptionKey(ticket);
    const key2 = deriveEncryptionKey(ticket);
    expect(key1).toEqual(key2);
    expect(key1.length).toBe(32);
  });

  it('signing key and encryption key are different', () => {
    const ticket = generateTicket();
    const sigSeed = deriveSigningSeed(ticket);
    const encKey = deriveEncryptionKey(ticket);
    expect(sigSeed).not.toEqual(encKey);
  });

  it('produces valid sr25519 signature', () => {
    const ticket = generateTicket();
    const message = new Uint8Array([1, 2, 3, 4]);
    const signature = signWithTicket(ticket, message);
    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature.length).toBe(64);
  });
});
