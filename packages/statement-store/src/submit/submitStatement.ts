import { toHex } from '@novasamatech/scale';
import type { Statement } from '@novasamatech/sdk-statement';
import type { ResultAsync } from 'neverthrow';

import type { StatementStoreAdapter } from '../adapter/types.js';
import type { StatementProver } from '../session/statementProver.js';

import type { ExpiryAllocator } from './allocator.js';
import type { SubmitRetryOptions } from './retry.js';
import { isPriorityTooLow, submitWithRetry } from './retry.js';

export type SubmitStatementParams = {
  statementStore: StatementStoreAdapter;
  prover: StatementProver;
  /**
   * Shared per-signing-account expiry source
   **/
  allocator: ExpiryAllocator;
  channel: Uint8Array;
  topics: Uint8Array[];
  /**
   * Opaque payload — encryption (if any) is the caller's concern.
   **/
  data: Uint8Array;
};

/**
 * One submit attempt: allocate the next expiry, build and prove the
 * statement, submit it, and on a priority rejection adopt the chain-reported
 * minimum into the allocator so the NEXT attempt clears it.
 */
export function submitStatementOnce(params: SubmitStatementParams): ResultAsync<void, Error> {
  const { statementStore, prover, allocator, channel, topics, data } = params;
  const unsigned: Statement = {
    expiry: allocator.next(),
    channel: toHex(channel),
    topics: topics.map(toHex),
    data,
  };
  return prover
    .generateMessageProof(unsigned)
    .andThen(statementStore.submitStatement)
    .orTee(error => {
      // The chain is the source of truth for the account/channel priority floor.
      if (isPriorityTooLow(error)) {
        allocator.raiseFloor(error.min);
      }
    });
}

export function signAndSubmitStatement(params: SubmitStatementParams & { retry: SubmitRetryOptions }) {
  return submitWithRetry(() => submitStatementOnce(params), {
    ...params.retry,
    // Adopt the chain-reported floor so the next retry submits strictly above it and clears.
    onPriorityError: error => params.allocator.raiseFloor(error.min),
  });
}
