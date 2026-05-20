import { blake2b } from '@noble/hashes/blake2.js';
import {
  deriveSlotAccountPublicKey as deriveSlotPublicKey,
  ensureSubstrateSlotSr25519Ready,
  signSlotAccountSecret as signSlotSecret,
  verifySlotAccountSignature as verifySlotSignature,
} from '@novasamatech/substrate-slot-sr25519-wasm';
import { entropyToMiniSecret } from '@polkadot-labs/hdkd-helpers';
import { HDKD as sr25519HDKD, secretFromSeed as sr25519SecretFromSeed } from '@scure/sr25519';
import type { Codec } from 'scale-ts';
import { Bytes, str, u64 } from 'scale-ts';

import { substrateSr25519PublicKey, substrateSr25519Sign, substrateSr25519Verify } from './substrateSr25519.js';

export { ensureSubstrateSlotSr25519Ready };
export { ensureSubstrateSr25519Ready } from './substrateSr25519.js';

export function BrandedBytesCodec<T extends Uint8Array>(length?: number) {
  return Bytes(length) as unknown as Codec<T>;
}

// helpers

const textEncoder = new TextEncoder();

export function stringToBytes(str: string) {
  return textEncoder.encode(str);
}

/**
 * blake2b_256 with key
 */
export function khash(secret: Uint8Array, message: Uint8Array) {
  return blake2b(message, { dkLen: 32, key: secret });
}

function parseDerivations(derivationsStr: string) {
  const DERIVATION_RE = /(\/{1,2})([^/]+)/g;

  const derivations = [] as [type: 'hard' | 'soft', code: string][];
  for (const [, type, code] of derivationsStr.matchAll(DERIVATION_RE)) {
    if (code) {
      derivations.push([type === '//' ? 'hard' : 'soft', code]);
    }
  }
  return derivations;
}

const JUNCTION_ID_LEN = 32;
const NUMERIC_JUNCTION_RE = /^\d+$/;

// Substrate `DeriveJunction` chain-code encoding (sp_core::crypto::DeriveJunction):
// - if the junction parses as an unsigned integer, SCALE-encode as u64 LE
// - otherwise SCALE-encode as a string (compact length + UTF-8)
// - if the encoded payload is longer than 32 bytes, replace it with blake2-256(payload)
// - left-pad / truncate the result into a 32-byte chain code
function createChainCode(derivation: string) {
  const encoded = NUMERIC_JUNCTION_RE.test(derivation) ? u64.enc(BigInt(derivation)) : str.enc(derivation);
  if (encoded.length > JUNCTION_ID_LEN) {
    return blake2b(encoded, { dkLen: JUNCTION_ID_LEN });
  }
  const chainCode = new Uint8Array(JUNCTION_ID_LEN);
  chainCode.set(encoded);
  return chainCode;
}

// statement store key pair

export function createSr25519Secret(entropy: Uint8Array, derivation?: string) {
  const miniSecret = entropyToMiniSecret(entropy);
  const secret = sr25519SecretFromSeed(miniSecret);

  return derivation ? createSr25519Derivation(secret, derivation) : secret;
}

export function createSr25519Derivation(secret: Uint8Array, derivation: string) {
  const derivations = parseDerivations(derivation);

  return derivations.reduce((secret, [type, derivation]) => {
    const chainCode = createChainCode(derivation);

    switch (type) {
      case 'hard':
        return sr25519HDKD.secretHard(secret, chainCode);

      case 'soft':
        return sr25519HDKD.secretSoft(secret, chainCode);
    }
  }, secret);
}

/** Ed25519-expanded secret (scure HDKD / `createSr25519Secret`). */
export function deriveSr25519PublicKey(secret: Uint8Array) {
  return substrateSr25519PublicKey(secret);
}

export function signWithSr25519Secret(secret: Uint8Array, message: Uint8Array) {
  return substrateSr25519Sign(secret, message);
}

export function verifySr25519Signature(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array) {
  return substrateSr25519Verify(message, signature, publicKey);
}

/**
 * Substrate slot secret (`privateKey || nonce`, 64 bytes) from mobile `SlotAccountKey`.
 * Matches Android `deriveAccountId()` / `Sr25519.getPublicKeyFromSecret`.
 */
export function deriveSlotAccountPublicKey(secret: Uint8Array) {
  return deriveSlotPublicKey(secret);
}

export function signSlotAccountSecret(secret: Uint8Array, message: Uint8Array) {
  return signSlotSecret(secret, message);
}

export function verifySlotAccountSignature(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array) {
  return verifySlotSignature(message, signature, publicKey);
}
