import type { Result } from 'neverthrow';
import { ResultAsync, err, ok } from 'neverthrow';

import { AccountFullError, ExpiryTooLowError } from '../adapter/types.js';

/**
 * AccountFull / ExpiryTooLow are priority errors: never a chain/statement
 * failure, only a sign the submitter's expiry lagged the chain's priority
 * floor (channel supersession for ExpiryTooLow, account-quota eviction for
 * AccountFull — both report the minimum to clear).
 */
export function isPriorityTooLow(error: unknown): error is ExpiryTooLowError | AccountFullError {
  return error instanceof ExpiryTooLowError || error instanceof AccountFullError;
}

export type SubmitRetryOptions = {
  /** Retry budget for non-priority (transient infra) errors. 0 = propagate immediately. */
  attempts: number;
  /**
   * Retry budget for priority errors. A number gives bounded retries then
   * propagation (for callers with their own outer retry/outbox). 'unbounded'
   * retries while `shouldRetry()` holds and, once it no longer does, settles a
   * priority rejection as success — the submission lost the channel race to a
   * newer statement, which is benign (session semantics).
   */
  priorityAttempts: number | 'unbounded';
  /** Backoff before each retry: a constant, or a per-retry schedule (last entry repeats). */
  delaysMs: number | number[];
  /** Liveness gate, re-checked before every retry. Default: always live. */
  shouldRetry?: () => boolean;
  /** Observe each scheduled retry (logging hook). `attempt` is 0-based. */
  onRetry?: (info: { attempt: number; delayMs: number; error: Error }) => void;
};

function delayFor(delaysMs: number | number[], attempt: number): number {
  if (typeof delaysMs === 'number') return delaysMs;
  return delaysMs[Math.min(attempt, delaysMs.length - 1)] ?? 0;
}

export function submitWithRetry(
  submit: () => ResultAsync<void, Error>,
  options: SubmitRetryOptions,
): ResultAsync<void, Error> {
  const { attempts, priorityAttempts, delaysMs, shouldRetry = () => true, onRetry } = options;

  // How to settle once we stop retrying: under the 'unbounded' policy a
  // no-longer-live submission rejected with a priority error simply lost the
  // channel race to a newer, higher-priority statement — benign, so report success.
  const settle = (error: Error): Result<void, Error> =>
    priorityAttempts === 'unbounded' && !shouldRetry() && isPriorityTooLow(error) ? ok() : err(error);

  // Iterative on purpose: a recursive ResultAsync chain holds one pending wrapper
  // promise per attempt, which grows without bound under 'unbounded' retries.
  const run = async (): Promise<Result<void, Error>> => {
    let attemptsLeft = attempts;
    let priorityLeft = priorityAttempts;
    for (let attempt = 0; ; attempt++) {
      const result = await submit();
      if (result.isOk()) return result;

      const error = result.error;
      const priority = isPriorityTooLow(error);
      const budgetLeft = priority ? priorityLeft : attemptsLeft;
      if (!shouldRetry() || (typeof budgetLeft === 'number' && budgetLeft <= 0)) return settle(error);

      const delayMs = delayFor(delaysMs, attempt);
      onRetry?.({ attempt, delayMs, error });
      if (priority) {
        if (priorityLeft !== 'unbounded') priorityLeft -= 1;
      } else {
        attemptsLeft -= 1;
      }
      await new Promise<void>(resolve => setTimeout(resolve, delayMs));
      if (!shouldRetry()) return settle(error);
    }
  };

  return new ResultAsync(run());
}
