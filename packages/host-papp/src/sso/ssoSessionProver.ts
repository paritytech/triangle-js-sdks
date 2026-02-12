import type { StatementProver } from '@novasamatech/statement-store';
import { createSr25519Prover } from '@novasamatech/statement-store';
import { err, ok } from 'neverthrow';

import type { UserSecretRepository } from './userSecretRepository.js';
import type { StoredUserSession } from './userSessionRepository.js';

export function createSsoStatementProver(
  userSession: StoredUserSession,
  userSecretRepository: UserSecretRepository,
): StatementProver {
  const prover = userSecretRepository
    .read(userSession.id)
    .andThen(secrets => (secrets ? ok(secrets) : err(new Error(`Secrets for session ${userSession.id} not found.`))))
    .map(x => createSr25519Prover(x.ssSecret));

  return {
    generateMessageProof(statement) {
      return prover.andThen(prover => prover.generateMessageProof(statement));
    },
    verifyMessageProof(statement) {
      return prover.andThen(prover => prover.verifyMessageProof(statement));
    },
  };
}
