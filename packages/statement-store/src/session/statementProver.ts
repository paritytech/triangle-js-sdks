import { fromHex } from '@novasamatech/scale';
import type { SignedStatement, Statement } from '@novasamatech/sdk-statement';
import { getStatementSigner, statementCodec } from '@novasamatech/sdk-statement';
import type { ResultAsync } from 'neverthrow';
import { errAsync, fromPromise, fromThrowable, okAsync } from 'neverthrow';
import { compact } from 'scale-ts';

import {
  deriveSlotAccountPublicKey,
  deriveSr25519PublicKey,
  signSlotAccountSecret,
  signWithSr25519Secret,
  verifySlotAccountSignature,
  verifySr25519Signature,
} from '../crypto.js';
import { toError } from '../helpers.js';

export type StatementProver = {
  generateMessageProof(statement: Statement): ResultAsync<SignedStatement, Error>;
  verifyMessageProof(statement: Statement): ResultAsync<boolean, Error>;
};

type Sr25519Scheme = {
  derivePublicKey: (secret: Uint8Array) => Uint8Array;
  sign: (secret: Uint8Array, message: Uint8Array) => Uint8Array;
  verify: (message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array) => boolean;
};

function createSr25519SchemeProver(secret: Uint8Array, scheme: Sr25519Scheme): StatementProver {
  const signer = getStatementSigner(scheme.derivePublicKey(secret), 'sr25519', data => scheme.sign(secret, data));
  const verify = fromThrowable(scheme.verify, toError);

  return {
    generateMessageProof(statement) {
      return fromPromise(signer.sign(statement), toError);
    },
    verifyMessageProof(statement) {
      const { proof, ...unsigned } = statement;

      if (!proof) {
        return errAsync(new Error('Proof is not provided'));
      }

      const encoded = statementCodec.enc(unsigned);
      const compactLen = compact.enc(compact.dec(encoded)).length;

      switch (proof.type) {
        case 'sr25519':
          return verify(
            encoded.slice(compactLen),
            fromHex(proof.value.signature),
            fromHex(proof.value.signer),
          ).asyncAndThen(x => okAsync(x));
        default:
          return errAsync(new Error(`Proof type ${proof.type} is not supported.`));
      }
    },
  };
}

/** Prover for scure-HDKD / device statement account secrets. */
export function createSr25519Prover(secret: Uint8Array): StatementProver {
  return createSr25519SchemeProver(secret, {
    derivePublicKey: deriveSr25519PublicKey,
    sign: signWithSr25519Secret,
    verify: verifySr25519Signature,
  });
}

/** Prover for a mobile slot-account secret (`privateKey || nonce`). Call `ensureSubstrateSlotSr25519Ready()` first. */
export function createSlotAccountProver(secret: Uint8Array): StatementProver {
  return createSr25519SchemeProver(secret, {
    derivePublicKey: deriveSlotAccountPublicKey,
    sign: signSlotAccountSecret,
    verify: verifySlotAccountSignature,
  });
}
