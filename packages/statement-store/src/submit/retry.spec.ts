import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { AccountFullError, ExpiryTooLowError } from '../adapter/types.js';

import { isPriorityTooLow, submitWithRetry } from './retry.js';

const FAST = { delaysMs: 1 }; // keep wall-clock time negligible

describe('isPriorityTooLow', () => {
  it('matches exactly the two priority error classes', () => {
    expect(isPriorityTooLow(new AccountFullError(0n, 1n))).toBe(true);
    expect(isPriorityTooLow(new ExpiryTooLowError(0n, 1n))).toBe(true);
    expect(isPriorityTooLow(new Error('store rejected'))).toBe(false);
  });
});

describe('submitWithRetry', () => {
  it("priorityAttempts 'unbounded': priority errors retry past the non-priority budget until they land", async () => {
    let calls = 0;
    const submit = vi.fn(() =>
      ++calls <= 6 ? errAsync<void, Error>(new AccountFullError(0n, 1n)) : okAsync<void, Error>(undefined),
    );

    const result = await submitWithRetry(submit, { ...FAST, attempts: 3, priorityAttempts: 'unbounded' });

    expect(result.isOk()).toBe(true);
    expect(calls).toBe(7);
  });

  it("priorityAttempts 'unbounded': a no-longer-live priority rejection settles as success", async () => {
    const submit = vi.fn(() => errAsync<void, Error>(new ExpiryTooLowError(0n, 1n)));

    const result = await submitWithRetry(submit, {
      ...FAST,
      attempts: 3,
      priorityAttempts: 'unbounded',
      shouldRetry: () => false,
    });

    expect(result.isOk()).toBe(true); // lost the channel race — benign
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('priorityAttempts budgeted: priority errors consume their budget then propagate', async () => {
    const submit = vi.fn(() => errAsync<void, Error>(new AccountFullError(0n, 1n)));

    const result = await submitWithRetry(submit, { ...FAST, attempts: 0, priorityAttempts: 3 });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(AccountFullError);
    expect(submit).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it('onPriorityError fires for every priority rejection, including the terminal one once the budget is exhausted', async () => {
    const seen: bigint[] = [];
    let calls = 0;
    const submit = vi.fn(() => errAsync<void, Error>(new AccountFullError(0n, BigInt(++calls))));

    const result = await submitWithRetry(submit, {
      ...FAST,
      attempts: 0,
      priorityAttempts: 2,
      onPriorityError: error => seen.push(error.min),
    });

    expect(result.isErr()).toBe(true);
    expect(submit).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(seen).toEqual([1n, 2n, 3n]); // adopted the floor on all three, including the terminal rejection
  });

  it('onPriorityError is not called for non-priority errors', async () => {
    const onPriorityError = vi.fn();
    const submit = vi.fn(() => errAsync<void, Error>(new Error('store rejected')));

    await submitWithRetry(submit, { ...FAST, attempts: 2, priorityAttempts: 'unbounded', onPriorityError });

    expect(onPriorityError).not.toHaveBeenCalled();
  });

  it('attempts 0: a non-priority error propagates immediately', async () => {
    const submit = vi.fn(() => errAsync<void, Error>(new Error('store rejected')));

    const result = await submitWithRetry(submit, { ...FAST, attempts: 0, priorityAttempts: 3 });

    expect(result.isErr()).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('non-priority errors consume the attempts budget then propagate', async () => {
    const submit = vi.fn(() => errAsync<void, Error>(new Error('store rejected')));

    const result = await submitWithRetry(submit, { ...FAST, attempts: 2, priorityAttempts: 'unbounded' });

    expect(result.isErr()).toBe(true);
    expect(submit).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('per-attempt delay schedule is honored and reported via onRetry', async () => {
    let calls = 0;
    const submit = vi.fn(() =>
      ++calls <= 2 ? errAsync<void, Error>(new AccountFullError(0n, 1n)) : okAsync<void, Error>(undefined),
    );
    const seen: { attempt: number; delayMs: number }[] = [];

    const result = await submitWithRetry(submit, {
      attempts: 0,
      priorityAttempts: 3,
      delaysMs: [1, 2, 3],
      onRetry: ({ attempt, delayMs }) => seen.push({ attempt, delayMs }),
    });

    expect(result.isOk()).toBe(true);
    expect(seen).toEqual([
      { attempt: 0, delayMs: 1 },
      { attempt: 1, delayMs: 2 },
    ]);
  });

  it('a negative budget propagates immediately instead of looping', async () => {
    const submit = vi.fn(() => errAsync<void, Error>(new Error('store rejected')));

    const result = await submitWithRetry(submit, { ...FAST, attempts: -1, priorityAttempts: 3 });

    expect(result.isErr()).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('a shouldRetry flip during the backoff settles a priority rejection as success', async () => {
    let live = true;
    const submit = vi.fn(() => {
      queueMicrotask(() => {
        live = false; // superseded while the backoff sleep is pending
      });
      return errAsync<void, Error>(new ExpiryTooLowError(0n, 1n));
    });

    const result = await submitWithRetry(submit, {
      ...FAST,
      attempts: 0,
      priorityAttempts: 'unbounded',
      shouldRetry: () => live,
    });

    expect(result.isOk()).toBe(true); // settled after the delay, no second attempt
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('shouldRetry is re-checked before each retry and stops the loop', async () => {
    let live = true;
    const submit = vi.fn(() => {
      live = false; // superseded after the first attempt
      return errAsync<void, Error>(new Error('store rejected'));
    });

    const result = await submitWithRetry(submit, {
      ...FAST,
      attempts: 3,
      priorityAttempts: 'unbounded',
      shouldRetry: () => live,
    });

    expect(result.isErr()).toBe(true); // non-priority + not live → propagate, no settle
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
