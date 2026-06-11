import type { Statement } from '@novasamatech/sdk-statement';
import type { ResultAsync } from 'neverthrow';
import { errAsync } from 'neverthrow';
import { toHex } from 'polkadot-api/utils';

import type { StatementStoreAdapter } from '../adapter/types.js';
import type { StatementProver } from '../session/statementProver.js';

import type { ExpiryAllocator } from './allocator.js';
import type { SubmitRetryOptions } from './retry.js';
import { isPriorityTooLow, submitWithRetry } from './retry.js';

export type SubmitStatementParams = {
  statementStore: StatementStoreAdapter;
  prover: StatementProver;
  /** Shared per-signing-account expiry source — see {@link ExpiryAllocator}. */
  allocator: ExpiryAllocator;
  channel: Uint8Array;
  topics: Uint8Array[];
  /** Opaque payload — encryption (if any) is the caller's concern. */
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
    channel: toHex(channel) as `0x${string}`,
    topics: topics.map(topic => toHex(topic) as `0x${string}`),
    data,
  };
  return prover
    .generateMessageProof(unsigned)
    .andThen(statementStore.submitStatement)
    .orElse(error => {
      // The chain is the source of truth for the account/channel priority floor.
      if (isPriorityTooLow(error)) allocator.raiseFloor(error.min);
      return errAsync(error);
    });
}

/** {@link submitStatementOnce} composed with {@link submitWithRetry}. */
export function signAndSubmitStatement(
  params: SubmitStatementParams & { retry: SubmitRetryOptions },
): ResultAsync<void, Error> {
  return submitWithRetry(() => submitStatementOnce(params), params.retry);
}
