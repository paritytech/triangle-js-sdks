import { setTimeout } from 'node:timers/promises';

import type { ResultAsync } from 'neverthrow';
import { err, fromPromise, ok, okAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { createAsyncTaskPool } from './createAsyncTaskPool.js';
import { toError } from './utils.js';

const delay = (ttl = 0) => setTimeout(ttl);

describe('asyncTaskPool', () => {
  it('should exec async task', async () => {
    const pool = createAsyncTaskPool({ poolSize: 1, retryCount: 0, retryDelay: () => 0 });
    const result = await pool.call(() =>
      fromPromise(
        delay().then(() => 'test'),
        toError,
      ),
    );

    expect(result).toEqual(ok('test'));
  });

  it('should handle sync errors', async () => {
    const pool = createAsyncTaskPool({ poolSize: 1, retryCount: 0, retryDelay: () => 0 });
    const error = new Error('test');
    const result = await pool.call(() => {
      throw error;
    });

    expect(result).toEqual(err(error));
  });

  it('should handle async errors', async () => {
    const pool = createAsyncTaskPool({ poolSize: 1, retryCount: 0, retryDelay: () => 0 });
    const error = new Error('test');
    const result = await pool.call(() => fromPromise(Promise.reject(error), toError));

    return expect(result).toEqual(err(error));
  });

  it('should handle queue', async () => {
    const pool = createAsyncTaskPool({ poolSize: 2, retryCount: 0, retryDelay: () => 0 });
    const spy = vi.fn();

    await Promise.all([pool.call(spy), pool.call(spy), pool.call(spy), pool.call(spy)]);

    expect(spy).toBeCalledTimes(4);
  });

  it('should update pool in correct order', async () => {
    const pool = createAsyncTaskPool({ poolSize: 2, retryCount: 0, retryDelay: () => 0 });
    const result: number[] = [];

    const res = Promise.all([
      pool.call(() =>
        fromPromise(
          delay(800).then(() => result.push(1)),
          toError,
        ),
      ),
      pool.call(() =>
        fromPromise(
          delay(100).then(() => result.push(2)),
          toError,
        ),
      ),
      pool.call(() =>
        fromPromise(
          delay(500).then(() => result.push(3)),
          toError,
        ),
      ),
      pool.call(() =>
        fromPromise(
          delay(100).then(() => result.push(4)),
          toError,
        ),
      ),
    ]);

    await res;

    expect(result).toEqual([2, 3, 4, 1]);
  });

  it('should retry', async () => {
    const pool = createAsyncTaskPool({ poolSize: 1, retryCount: 1, retryDelay: () => 0 });
    let tries = 0;

    const result = await pool.call(() => {
      if (tries === 1) {
        return okAsync('test');
      }
      tries++;
      throw new Error();
    });

    expect(result).toEqual(ok('test'));
  });

  it('should throw on retry limit exceeding', async () => {
    const spy = vi.fn(() => 0);
    const pool = createAsyncTaskPool({ poolSize: 1, retryCount: 1, retryDelay: spy });
    let tries = 0;

    const result = await pool.call(() => {
      if (tries === 2) {
        return okAsync('test');
      }
      tries++;
      throw new Error();
    });

    expect(spy).toBeCalledTimes(1);
    expect(result).toEqual(err(new Error()));
  });

  it('should correctly calculate retry delay', async () => {
    const spy = vi.fn((retry: number) => retry * 10);
    const pool = createAsyncTaskPool({ poolSize: 1, retryCount: 2, retryDelay: spy });
    let tries = 0;

    await pool.call(() => {
      if (tries === 2) {
        return okAsync('test');
      }
      tries++;
      throw new Error();
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls).toEqual([[0], [1]]);
  });

  it('should create multiple pools', async () => {
    const spy = vi.fn();
    const pool = createAsyncTaskPool({ poolSize: 1, retryCount: 0, retryDelay: 0 });
    const tasks = [
      { delay: 600, value: 1, pool: '1' },
      { delay: 400, value: 2, pool: '2' },
      { delay: 100, value: 3, pool: '1' },
      { delay: 0, value: 4, pool: '2' },
    ];

    const result: ResultAsync<unknown, unknown>[] = [];

    for (const task of tasks) {
      const call = pool.call(
        () =>
          fromPromise(
            delay(task.delay).then(() => spy(task.value)),
            toError,
          ),
        { pool: task.pool },
      );
      result.push(call);
    }

    await Promise.all(result);

    expect(spy).toHaveBeenCalledTimes(4);
    expect(spy.mock.calls).toEqual([[2], [4], [1], [3]]);
  }, 10000);

  it('should settle all tasks', async () => {
    const pool = createAsyncTaskPool({ poolSize: 1, retryCount: 0, retryDelay: 0 });
    const tasks = [
      { delay: 0, value: 1 },
      { delay: 0, value: 2 },
      { delay: 0, value: 3 },
      { delay: 0, value: 4 },
    ];

    const result: number[] = [];

    for (const task of tasks) {
      pool.call(() => fromPromise(delay(task.delay), toError).andTee(() => result.push(task.value)), { pool: 'test' });
    }

    await pool.settle('test');

    expect(result).toEqual([1, 2, 3, 4]);
  });

  describe('abort signal', () => {
    it('rejects a queued task when the signal aborts, without ever running it', async () => {
      const pool = createAsyncTaskPool({ poolSize: 1, retryCount: 0, retryDelay: 0 });
      const controller = new AbortController();
      const queuedSpy = vi.fn(() => okAsync('queued'));

      // Occupy the single slot with a slow task so the next call has to queue.
      const active = pool.call(() =>
        fromPromise(
          delay(50).then(() => 'active'),
          toError,
        ),
      );
      const queued = pool.call(queuedSpy, { signal: controller.signal });

      controller.abort();

      const queuedResult = await queued;
      expect(queuedResult.isErr()).toBe(true);
      expect(queuedSpy).not.toHaveBeenCalled();
      expect((await active).isOk()).toBe(true);
    });

    it('rejects the in-flight active task when the signal aborts', async () => {
      const pool = createAsyncTaskPool({ poolSize: 1, retryCount: 0, retryDelay: 0 });
      const controller = new AbortController();

      const active = pool.call(
        () =>
          fromPromise(
            delay(10_000).then(() => 'done'),
            toError,
          ),
        {
          signal: controller.signal,
        },
      );

      controller.abort();

      expect((await active).isErr()).toBe(true);
    });

    it('frees the slot for later tasks after an abort', async () => {
      const pool = createAsyncTaskPool({ poolSize: 1, retryCount: 0, retryDelay: 0 });
      const controller = new AbortController();

      const aborted = pool.call(
        () =>
          fromPromise(
            delay(10_000).then(() => 'never'),
            toError,
          ),
        {
          signal: controller.signal,
        },
      );
      controller.abort();
      await aborted;

      const next = await pool.call(() => okAsync('next'));
      expect(next).toEqual(ok('next'));
    });

    it('rejects immediately when called with an already-aborted signal', async () => {
      const pool = createAsyncTaskPool({ poolSize: 1, retryCount: 0, retryDelay: 0 });
      const controller = new AbortController();
      controller.abort();
      const spy = vi.fn(() => okAsync('x'));

      const result = await pool.call(spy, { signal: controller.signal });

      expect(result.isErr()).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  it('should settle tasks that was created by chain reaction', async () => {
    const pool = createAsyncTaskPool({ poolSize: 1, retryCount: 0, retryDelay: 0 });
    const tasks = [
      { delay: 10, value: 1 },
      { delay: 10, value: 2 },
      { delay: 10, value: 3 },
      { delay: 10, value: 4 },
    ];

    const result: number[] = [];

    for (const task of tasks) {
      pool
        .call(() => fromPromise(delay(task.delay), toError), { pool: 'test' })
        .then(() => {
          result.push(task.value);
          pool.call(
            () =>
              fromPromise(
                delay(task.delay).then(() => result.push(task.value + 10)),
                toError,
              ),
            { pool: 'test' },
          );
        });
    }

    await pool.settle('test');

    expect(result).toEqual([1, 2, 3, 4, 11, 12, 13, 14]);
  });
});
