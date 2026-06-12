import { blake2b } from '@noble/hashes/blake2.js';
import {
  ensureSubstrateSlotSr25519Ready,
  substrateSlotSecretFromSeedBytes,
} from '@novasamatech/substrate-slot-sr25519-wasm';
import { mnemonicToEntropy, mnemonicToMiniSecret } from '@polkadot-labs/hdkd-helpers';
import * as schnorrkelWasm from '@polkadot-labs/schnorrkel-wasm';
import { HDKD, secretFromSeed } from '@scure/sr25519';
import { str, u64 } from 'scale-ts';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  createSr25519Secret,
  deriveSlotAccountPublicKey,
  deriveSr25519PublicKey,
  signSlotAccountSecret,
  signWithSr25519Secret,
  verifySlotAccountSignature,
  verifySr25519Signature,
} from './crypto.js';

const { sr25519_derive_keypair_hard, sr25519_keypair_from_seed, sr25519_pubkey } = schnorrkelWasm;
const initSchnorrkelWasm = (schnorrkelWasm as typeof schnorrkelWasm & { init: () => void }).init;

const DEV_MNEMONIC = 'bottom drive obey lake curtain smoke basket hold race lonely fit walk';
const ALLOWANCE_PATH = '//allowance//bulletin//localhost:5173';

const toHex = (bytes: Uint8Array) => `0x${[...bytes].map(b => b.toString(16).padStart(2, '0')).join('')}`;

function createChainCode(derivation: string) {
  const encoded = /^\d+$/.test(derivation) ? u64.enc(BigInt(derivation)) : str.enc(derivation);
  if (encoded.length > 32) {
    return blake2b(encoded, { dkLen: 32 });
  }
  const chainCode = new Uint8Array(32);
  chainCode.set(encoded);

  return chainCode;
}

function wasmDeriveAllowanceKeypair(miniSecret: Uint8Array) {
  initSchnorrkelWasm();
  let pair = sr25519_keypair_from_seed(miniSecret);
  for (const match of ALLOWANCE_PATH.matchAll(/(\/{1,2})([^/]+)/g)) {
    const type = match[1];
    const code = match[2];
    if (!type || !code) {
      continue;
    }
    if (type !== '//') {
      throw new Error('soft junction not expected in test path');
    }
    pair = sr25519_derive_keypair_hard(pair, createChainCode(code));
  }

  return pair;
}

describe('sr25519 crypto (Substrate-compatible)', () => {
  beforeAll(async () => {
    initSchnorrkelWasm();
    await ensureSubstrateSlotSr25519Ready();
  });

  it('derives the same public key as schnorrkel-wasm for an allowance path secret', () => {
    const entropy = mnemonicToEntropy(DEV_MNEMONIC);
    const miniSecret = mnemonicToMiniSecret(DEV_MNEMONIC);
    const secret = createSr25519Secret(entropy, ALLOWANCE_PATH);
    const wasmPair = wasmDeriveAllowanceKeypair(miniSecret);
    const wasmPublicKey = wasmPair.slice(64, 96);

    expect(deriveSr25519PublicKey(secret)).toEqual(wasmPublicKey);
    expect(toHex(deriveSr25519PublicKey(secret))).toBe(toHex(wasmPublicKey));
  });

  it('derives slot account pubkey via SecretKey::from_bytes (mobile SlotAccountKey shape)', () => {
    const miniSecret = mnemonicToMiniSecret(DEV_MNEMONIC);
    const slotSecret = substrateSlotSecretFromSeedBytes(miniSecret);
    const wasmPublicKey = deriveSlotAccountPublicKey(slotSecret);

    expect(wasmPublicKey).not.toEqual(sr25519_pubkey(slotSecret));
    expect(deriveSlotAccountPublicKey(slotSecret)).toEqual(wasmPublicKey);
  });

  it('signs and verifies slot-account secrets with the substrate context', () => {
    const miniSecret = mnemonicToMiniSecret(DEV_MNEMONIC);
    const slotSecret = substrateSlotSecretFromSeedBytes(miniSecret);
    const publicKey = deriveSlotAccountPublicKey(slotSecret);
    const message = new TextEncoder().encode('substrate-context-test');
    const signature = signSlotAccountSecret(slotSecret, message);

    expect(verifySlotAccountSignature(message, signature, publicKey)).toBe(true);
  });

  it('signs and verifies ed25519-expanded secrets with the substrate context', () => {
    const secret = createSr25519Secret(mnemonicToEntropy(DEV_MNEMONIC), ALLOWANCE_PATH);
    const publicKey = deriveSr25519PublicKey(secret);
    const message = new TextEncoder().encode('substrate-context-test');
    const signature = signWithSr25519Secret(secret, message);

    expect(verifySr25519Signature(message, signature, publicKey)).toBe(true);
  });

  it('matches scure HDKD secret bytes for wasm-derived allowance keys', () => {
    const miniSecret = mnemonicToMiniSecret(DEV_MNEMONIC);
    let scureSecret = secretFromSeed(miniSecret);
    for (const match of ALLOWANCE_PATH.matchAll(/(\/{1,2})([^/]+)/g)) {
      const type = match[1];
      const code = match[2];
      if (!type || !code) {
        continue;
      }
      const cc = createChainCode(code);
      scureSecret = Uint8Array.from(
        type === '//' ? HDKD.secretHard(scureSecret, cc) : HDKD.secretSoft(scureSecret, cc),
      );
    }
    const wasmSecret = wasmDeriveAllowanceKeypair(miniSecret).slice(0, 64);

    expect(toHex(scureSecret)).toBe(toHex(wasmSecret));
  });
});
