import { p256 } from '@noble/curves/nist.js';
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
export const EncrPubKey = BrandedBytesCodec<EncrPublicKey>(65);

// helpers

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function stringToBytes(str: string) {
  return textEncoder.encode(str);
}

export function bytesToString(bytes: Uint8Array) {
  return textDecoder.decode(bytes);
}

// sr25519 account

export type DerivedSr25519Account = {
  secret: SsSecret;
  publicKey: SsPublicKey;
  entropy: Uint8Array;
  sign(message: Uint8Array): Uint8Array;
  verify(message: Uint8Array, signature: Uint8Array): boolean;
};

export function deriveSr25519Account(mnemonic: string, derivation: string): DerivedSr25519Account {
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
  const miniSecret = entropyToMiniSecret(entropy);
  const seed = new Uint8Array(48);
  seed.set(miniSecret);
  const { secretKey } = p256.keygen(seed);
  return secretKey as EncrSecret;
}

export function getEncrPub(secret: EncrSecret) {
  return p256.getPublicKey(secret, false) as EncrPublicKey;
}

export function createSharedSecret(secret: EncrSecret, publicKey: Uint8Array) {
  // slicing first byte: @noble/curves adds y offset at the start
  return p256.getSharedSecret(secret, publicKey).slice(1, 33) as SharedSecret;
}
