import { blake2b } from '@noble/hashes/blake2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import {
  getPublicKey as sr25519GetPublicKey,
  secretFromSeed as sr25519SecretFromSeed,
  sign as sr25519Sign,
} from '@scure/sr25519';

const textEncoder = new TextEncoder();

function khash(secret: Uint8Array, message: Uint8Array): Uint8Array {
  return blake2b(message, { dkLen: 32, key: secret });
}

export type FileTicket = Uint8Array;

export function generateTicket(): FileTicket {
  return randomBytes(32);
}

export function deriveSigningSeed(ticket: FileTicket): Uint8Array {
  return khash(ticket, textEncoder.encode('signer'));
}

export function deriveSigningKeypair(ticket: FileTicket): Uint8Array {
  const seed = deriveSigningSeed(ticket);
  return sr25519SecretFromSeed(seed);
}

export function derivePublicKey(ticket: FileTicket): Uint8Array {
  const keypair = deriveSigningKeypair(ticket);
  return sr25519GetPublicKey(keypair) as Uint8Array;
}

export function signWithTicket(ticket: FileTicket, message: Uint8Array): Uint8Array {
  const keypair = deriveSigningKeypair(ticket);
  return sr25519Sign(keypair, message);
}

export function deriveEncryptionKey(ticket: FileTicket): Uint8Array {
  return khash(ticket, textEncoder.encode('encryption'));
}
