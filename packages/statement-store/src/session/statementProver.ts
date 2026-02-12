import type { SignedStatement, Statement } from '@polkadot-api/sdk-statement';
import { getStatementSigner, statementCodec } from '@polkadot-api/sdk-statement';
import type { ResultAsync } from 'neverthrow';
import { errAsync, fromPromise, fromThrowable, okAsync } from 'neverthrow';
import { compact } from 'scale-ts';

import { deriveSr25519PublicKey, signWithSr25519Secret, verifySr25519Signature } from '../crypto.js';
import { toError } from '../helpers.js';

export type StatementProver = {
  generateMessageProof(statement: Statement): ResultAsync<SignedStatement, Error>;
  verifyMessageProof(statement: Statement): ResultAsync<boolean, Error>;
};

export function createSr25519Prover(secret: Uint8Array): StatementProver {
  const signer = getStatementSigner(deriveSr25519PublicKey(secret), 'sr25519', data =>
    signWithSr25519Secret(secret, data),
  );
  const verify = fromThrowable(verifySr25519Signature, toError);

  return {
    generateMessageProof(statement) {
      return fromPromise(signer.sign(statement), toError);
    },
    verifyMessageProof(statement) {
      const { proof, ...unsigned } = statement;

      if (!proof) {
        // TODO should we pass check when proof is not presented?
        return okAsync(true);
      }

      const encoded = statementCodec.enc(unsigned);
      const compactLen = compact.enc(compact.dec(encoded)).length;

      switch (proof.type) {
        case 'sr25519':
          return verify(
            encoded.slice(compactLen),
            proof.value.signature.asBytes(),
            proof.value.signer.asBytes(),
          ).asyncAndThen(x => okAsync(x));
        default:
          return errAsync(new Error(`Proof type ${proof.type} is not supported.`));
      }
    },
  };
}
