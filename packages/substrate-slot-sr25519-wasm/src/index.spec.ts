// Imports the package by name (not `./index.js`) on purpose: the wasm is inlined as a `data:` URL
// only in the built `dist/`. The TypeScript source resolves it to a `file:` URL that Node's
// `fetch` can't load, so the source can't init standalone in Node — the built artifact is what
// runs everywhere and what consumers get. Run `npm run build` before this spec.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  deriveSlotAccountPublicKey,
  ensureSubstrateSlotSr25519Ready,
  signSlotAccountSecret,
  substrateSlotSecretFromSeedBytes,
  verifySlotAccountSignature,
} from '@novasamatech/substrate-slot-sr25519-wasm';

import { beforeAll, describe, expect, it } from 'vitest';

const toHex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

// Fixed 32-byte seed `[1, 2, ..., 32]`. The derived secret/public key are deterministic, so these
// hex vectors guard against silent changes to the wasm crypto. (Signatures are NOT deterministic —
// sr25519 signing draws a random nonce — so we only round-trip them, never assert their bytes.)
const SEED = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const EXPECTED_SECRET =
  '0eef5183411d40c32446bb1cbaabd70004a17af6012a577c735d054f04059208573dfc9b6ffeb1c786a16349e70f9836876a743c31c0a7a2a70727a852eec372';
const EXPECTED_PUBLIC_KEY = '10c68432943c68a6e1be650818b5e08db79e57823de9f34df7ba36d404d91e1d';
const MESSAGE = new TextEncoder().encode('hello-slot');

describe('substrate-slot-sr25519-wasm', () => {
  // The two "derives ..." tests below re-derive inline so they stay self-contained assertions on
  // the derivation functions; the signing tests reuse this shared key pair.
  let secret: Uint8Array;
  let publicKey: Uint8Array;

  beforeAll(async () => {
    await ensureSubstrateSlotSr25519Ready();
    secret = substrateSlotSecretFromSeedBytes(SEED);
    publicKey = deriveSlotAccountPublicKey(secret);
  });

  it('is idempotent to initialize', async () => {
    await expect(ensureSubstrateSlotSr25519Ready()).resolves.toBeUndefined();
  });

  it('derives a deterministic 64-byte slot secret from a seed', () => {
    const secret = substrateSlotSecretFromSeedBytes(SEED);

    expect(secret).toBeInstanceOf(Uint8Array);
    expect(secret.length).toBe(64);
    expect(toHex(secret)).toBe(EXPECTED_SECRET);
  });

  it('derives a deterministic 32-byte public key from a slot secret', () => {
    const publicKey = deriveSlotAccountPublicKey(substrateSlotSecretFromSeedBytes(SEED));

    expect(publicKey.length).toBe(32);
    expect(toHex(publicKey)).toBe(EXPECTED_PUBLIC_KEY);
  });

  it('verifies a signature it produced', () => {
    const signature = signSlotAccountSecret(secret, MESSAGE);

    expect(signature.length).toBe(64);
    expect(verifySlotAccountSignature(MESSAGE, signature, publicKey)).toBe(true);
  });

  it('rejects a signature against a tampered message', () => {
    const signature = signSlotAccountSecret(secret, MESSAGE);
    const tampered = new TextEncoder().encode('hello-sl0t');

    expect(verifySlotAccountSignature(tampered, signature, publicKey)).toBe(false);
  });

  it('rejects a signature against the wrong public key', () => {
    const signature = signSlotAccountSecret(secret, MESSAGE);
    const otherPublicKey = deriveSlotAccountPublicKey(
      substrateSlotSecretFromSeedBytes(Uint8Array.from({ length: 32 }, (_, i) => i + 100)),
    );

    expect(verifySlotAccountSignature(MESSAGE, signature, otherPublicKey)).toBe(false);
  });
});
