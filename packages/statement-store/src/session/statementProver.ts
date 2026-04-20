import type { SignedStatement, Statement } from '@novasamatech/sdk-statement';
import { getStatementSigner, statementCodec } from '@novasamatech/sdk-statement';
import { compact } from '@polkadot-api/substrate-bindings';
import type { ResultAsync } from 'neverthrow';
import { errAsync, fromPromise, fromThrowable, okAsync } from 'neverthrow';
import { fromHex } from 'polkadot-api/utils';

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
            fromHex(proof.value.signature),
            fromHex(proof.value.signer),
          ).asyncAndThen(x => okAsync(x));
        default:
          return errAsync(new Error(`Proof type ${proof.type} is not supported.`));
      }
    },
  };
}
