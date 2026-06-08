import type { SignedStatement, Statement } from '@novasamatech/sdk-statement';
import { createExpiryFromDuration } from '@novasamatech/sdk-statement';
import {
  ensureSubstrateSlotSr25519Ready,
  substrateSlotSecretFromSeedBytes,
} from '@novasamatech/substrate-slot-sr25519-wasm';
import { mnemonicToEntropy, mnemonicToMiniSecret } from '@polkadot-labs/hdkd-helpers';
import { beforeAll, describe, expect, it } from 'vitest';

import { createSr25519Secret, deriveSlotAccountPublicKey, deriveSr25519PublicKey } from '../crypto.js';

import { createSlotAccountProver, createSr25519Prover } from './statementProver.js';

const DEV_MNEMONIC = 'bottom drive obey lake curtain smoke basket hold race lonely fit walk';

const toHex = (bytes: Uint8Array) => `0x${[...bytes].map(b => b.toString(16).padStart(2, '0')).join('')}`;

function makeStatement(data: Uint8Array): Statement {
  return {
    expiry: createExpiryFromDuration(7 * 24 * 60 * 60),
    data,
    topics: [],
    channel: `0x${'00'.repeat(32)}`,
  };
}

function proofSigner(signed: SignedStatement): string {
  if (signed.proof.type !== 'sr25519') {
    throw new Error(`unexpected proof type ${signed.proof.type}`);
  }

  return signed.proof.value.signer;
}

describe('statementProver', () => {
  beforeAll(async () => {
    // Only the slot scheme needs explicit init; the scure path initializes lazily.
    await ensureSubstrateSlotSr25519Ready();
  });

  describe('createSr25519Prover (scure-HDKD secrets)', () => {
    it('signs a statement under the scure-derived public key and verifies it', async () => {
      const secret = createSr25519Secret(mnemonicToEntropy(DEV_MNEMONIC));
      const prover = createSr25519Prover(secret);
      const signed = (await prover.generateMessageProof(makeStatement(new Uint8Array([1, 2, 3]))))._unsafeUnwrap();

      expect(proofSigner(signed)).toBe(toHex(deriveSr25519PublicKey(secret)));

      const verified = await prover.verifyMessageProof(signed);
      expect(verified._unsafeUnwrap()).toBe(true);
    });
  });

  describe('createSlotAccountProver (mobile slot secrets)', () => {
    // Derived inside each test: the wasm is only ready after beforeAll runs.
    const makeSlotSecret = () => substrateSlotSecretFromSeedBytes(mnemonicToMiniSecret(DEV_MNEMONIC));

    it('signs a statement under the slot-derived public key and verifies it', async () => {
      const slotSecret = makeSlotSecret();
      const prover = createSlotAccountProver(slotSecret);
      const signed = (await prover.generateMessageProof(makeStatement(new Uint8Array([4, 5, 6]))))._unsafeUnwrap();

      expect(proofSigner(signed)).toBe(toHex(deriveSlotAccountPublicKey(slotSecret)));

      const verified = await prover.verifyMessageProof(signed);
      expect(verified._unsafeUnwrap()).toBe(true);
    });

    it('signs under a different public key than the scure prover would for the same secret', () => {
      // Regression guard: a slot secret pushed through the scure scheme derives the WRONG
      // signer, which is the bug createSlotAccountProver fixes for getStatementStoreProver.
      const slotSecret = makeSlotSecret();
      expect(toHex(deriveSlotAccountPublicKey(slotSecret))).not.toBe(toHex(deriveSr25519PublicKey(slotSecret)));
    });

    it('rejects a proof whose statement data was tampered with', async () => {
      const slotSecret = makeSlotSecret();
      const prover = createSlotAccountProver(slotSecret);
      const signed = (await prover.generateMessageProof(makeStatement(new Uint8Array([7, 8, 9]))))._unsafeUnwrap();

      const tampered: SignedStatement = { ...signed, data: new Uint8Array([9, 9, 9]) };
      const verified = await prover.verifyMessageProof(tampered);

      expect(verified._unsafeUnwrap()).toBe(false);
    });
  });

  describe('verifyMessageProof', () => {
    it('errors when the statement carries no proof', async () => {
      const prover = createSr25519Prover(createSr25519Secret(mnemonicToEntropy(DEV_MNEMONIC)));

      const verified = await prover.verifyMessageProof(makeStatement(new Uint8Array([1])));

      expect(verified.isErr()).toBe(true);
    });
  });
});
