import { x25519 } from '@noble/curves/ed25519.js';
import {
  createSr25519Secret,
  deriveSr25519PublicKey,
  signWithSr25519Secret,
  verifySr25519Signature,
} from '@novasamatech/statement-store';
import { entropyToMiniSecret, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers';
import type { Codec } from 'scale-ts';
import { Bytes } from 'scale-ts';

import type { Branded } from './types.js';

// types

export type SsPublicKey = Branded<Uint8Array, 'SsPublicKey'>;
export type SsSecret = Branded<Uint8Array, 'SsSecret'>;

export type EncrPublicKey = Branded<Uint8Array, 'EncrPublicKey'>;
export type EncrSecret = Branded<Uint8Array, 'EncrSecret'>;
export type SharedSecret = Branded<Uint8Array, 'SharedSecret'>;

export type SharedSession = Branded<Uint8Array, 'SharedSession'>;

// schemas

export function BrandedBytesCodec<T extends Uint8Array>(length?: number) {
  return Bytes(length) as unknown as Codec<T>;
}

export const SsPubKey = BrandedBytesCodec<SsPublicKey>(32);
export const EncrPubKey = BrandedBytesCodec<EncrPublicKey>(32);

// helpers

const textEncoder = new TextEncoder();

export function stringToBytes(str: string) {
  return textEncoder.encode(str);
}

// sr25519 account

export type DerivedSr25519Account = {
  secret: SsSecret;
  publicKey: SsPublicKey;
  entropy: Uint8Array;
  sign(message: Uint8Array): Uint8Array;
  verify(message: Uint8Array, signature: Uint8Array): boolean;
};

export function deriveSr25519Account(mnemonic: string, derivation?: string): DerivedSr25519Account {
  const entropy = mnemonicToEntropy(mnemonic);
  const secret = createSr25519Secret(entropy, derivation) as SsSecret;
  const publicKey = deriveSr25519PublicKey(secret) as SsPublicKey;

  return {
    secret,
    publicKey,
    entropy,
    sign: message => signWithSr25519Secret(secret, message),
    verify: (message, signature) => verifySr25519Signature(message, signature, publicKey),
  };
}

// encryption key pair

export function createEncrSecret(entropy: Uint8Array) {
  // The 32-byte mini-secret is the X25519 private scalar (clamped internally by @noble on use).
  return entropyToMiniSecret(entropy) as EncrSecret;
}

export function getEncrPub(secret: EncrSecret) {
  return x25519.getPublicKey(secret) as EncrPublicKey;
}

export function createSharedSecret(secret: EncrSecret, publicKey: Uint8Array) {
  // The X25519 output is used whole. @noble aborts on an all-zero (small-order) result per RFC 7748.
  return x25519.getSharedSecret(secret, publicKey) as SharedSecret;
}
