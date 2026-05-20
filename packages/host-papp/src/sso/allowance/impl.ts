import type { StatementProver } from '@novasamatech/statement-store';
import {
  createSr25519Prover,
  deriveSlotAccountPublicKey,
  ensureSubstrateSlotSr25519Ready,
  signSlotAccountSecret,
} from '@novasamatech/statement-store';
import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import type { PolkadotSigner } from 'polkadot-api/signer';
import { getPolkadotSigner } from 'polkadot-api/signer';

import type { Callback } from '../../types.js';
import type { ApAllocatableResource } from '../sessionManager/scale/resourceAllocation.js';
import type { UserSession } from '../sessionManager/userSession.js';

import type { AllowanceRepository, AllowanceResourceKind } from './repository.js';

export type AllowanceErrorReason = 'NoSession' | 'Rejected' | 'NotAvailable' | 'UnexpectedResponse';

export class AllowanceError extends Error {
  readonly reason: AllowanceErrorReason;

  constructor(reason: AllowanceErrorReason, message?: string) {
    super(message ?? reason);
    this.reason = reason;
    this.name = 'AllowanceError';
  }
}

type SessionsView = {
  read(): UserSession[];
  subscribe(callback: Callback<UserSession[]>): VoidFunction;
};

export type AllowanceService = {
  getBulletinSigner(sessionId: string, productId: string): ResultAsync<PolkadotSigner, AllowanceError>;
  getStatementStoreProver(sessionId: string, productId: string): ResultAsync<StatementProver, AllowanceError>;
};

export function createAllowanceService({
  sessions,
  repository,
}: {
  sessions: SessionsView;
  repository: AllowanceRepository;
}): AllowanceService {
  const fetchKey = (
    sessionId: string,
    productId: string,
    resource: AllowanceResourceKind,
  ): ResultAsync<Uint8Array, AllowanceError> => {
    return repository
      .read(sessionId, productId, resource)
      .mapErr(e => new AllowanceError('UnexpectedResponse', e.message))
      .andThen(cached => (cached ? okAsync(cached) : requestFromMobile(sessionId, productId, resource)));
  };

  const requestFromMobile = (
    sessionId: string,
    productId: string,
    resource: AllowanceResourceKind,
  ): ResultAsync<Uint8Array, AllowanceError> => {
    const session = sessions.read().find(s => s.id === sessionId);
    if (!session) {
      return errAsync(new AllowanceError('NoSession', `No active session ${sessionId}`));
    }

    return session
      .requestResourceAllocation({
        callingProductId: productId,
        resources: [toApResource(resource)],
        onExisting: 'Ignore',
      })
      .mapErr(e => new AllowanceError('UnexpectedResponse', e.message))
      .andThen(outcomes => {
        const outcome = outcomes[0];
        if (!outcome) {
          return errAsync(new AllowanceError('UnexpectedResponse', 'Empty allocation response'));
        }
        if (outcome.tag === 'Rejected') {
          return errAsync(new AllowanceError('Rejected', `Allowance request rejected for ${resource}`));
        }
        if (outcome.tag === 'NotAvailable') {
          return errAsync(new AllowanceError('NotAvailable', `Allowance not available for ${resource}`));
        }
        const allocated = outcome.value;
        const expectedTag = resource === 'bulletin' ? 'BulletInAllowance' : 'StatementStoreAllowance';
        if (allocated.tag !== expectedTag) {
          return errAsync(new AllowanceError('UnexpectedResponse', `Expected ${expectedTag}, got ${allocated.tag}`));
        }
        const slotAccountKey = allocated.value.slotAccountKey;

        return repository
          .write(sessionId, productId, resource, slotAccountKey)
          .mapErr(e => new AllowanceError('UnexpectedResponse', e.message))
          .map(() => slotAccountKey);
      });
  };

  return {
    getBulletinSigner(sessionId, productId) {
      return fetchKey(sessionId, productId, 'bulletin').andThen(secret =>
        ResultAsync.fromPromise(
          ensureSubstrateSlotSr25519Ready().then(() =>
            getPolkadotSigner(deriveSlotAccountPublicKey(secret), 'Sr25519', input =>
              signSlotAccountSecret(secret, input),
            ),
          ),
          e => new AllowanceError('UnexpectedResponse', e instanceof Error ? e.message : String(e)),
        ),
      );
    },
    getStatementStoreProver(sessionId, productId) {
      return fetchKey(sessionId, productId, 'statementStore').map(secret => createSr25519Prover(secret));
    },
  };
}

function toApResource(resource: AllowanceResourceKind): ApAllocatableResource {
  switch (resource) {
    case 'bulletin':
      return { tag: 'BulletInAllowance', value: undefined };
    case 'statementStore':
      return { tag: 'StatementStoreAllowance', value: undefined };
  }
}
