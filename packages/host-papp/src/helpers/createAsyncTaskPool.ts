import { createNanoEvents } from 'nanoevents';
import type { ResultAsync } from 'neverthrow';
import { fromPromise } from 'neverthrow';

import { promiseWithResolvers } from './promiseWithResolvers.js';
import { nullable, toError } from './utils.js';

export const DEFAULT_POOL = 'default';

type Params = {
  poolSize: number;
  retryCount: number;
  retryDelay: ((attempt: number) => number) | number;
};

type Task<T = unknown> = {
  fn: () => ResultAsync<T, Error>;
  pool: string;
  retry: number;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  retryTimeout?: ReturnType<typeof setTimeout>;
};

type TaskParams = { pool?: string; signal?: AbortSignal };

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Task aborted');
}

/**
 * Task manager with queues, retries and named pools.
 */
class AsyncTaskPool {
  private config: Params;
  private events = createNanoEvents<{
    settled: (pool: string) => void;
  }>();
  private queue: Task[] = [];
  private activeTasks: Task[] = [];

  constructor(config: Params) {
    this.config = config;
  }

  call<T>(fn: () => ResultAsync<T, Error>, params?: TaskParams) {
    const { resolve, reject, promise } = promiseWithResolvers<T>();
    const signal = params?.signal;

    // An already-aborted signal never enqueues the task — reject up-front.
    if (signal?.aborted) {
      reject(abortReason(signal));
      return fromPromise(promise, toError);
    }

    const task: Task<T> = {
      fn,
      pool: params?.pool ?? DEFAULT_POOL,
      retry: 0,
      resolve,
      reject,
      signal,
    };

    signal?.addEventListener('abort', () => this.abortTask(task as Task), { once: true });

    this.queue.push(task as Task);
    this.processPool(task.pool);

    return fromPromise(promise, toError);
  }

  settle(pool: string) {
    if (this.queue.length === 0 && this.activeTasks.length === 0) {
      return Promise.resolve();
    }

    return new Promise<void>(resolve => {
      const handler = (done: string) => {
        if (done === pool) {
          unsubscribe();
          resolve();
        }
      };

      const unsubscribe = this.events.on('settled', handler);
    });
  }

  // Drop a task because its signal aborted, whether it is still queued, waiting on a
  // retry timer, or already running. Rejecting a promise that later settles on its own
  // is a no-op, so the in-flight fn finishing afterwards can't override this rejection.
  private abortTask(task: Task) {
    if (task.retryTimeout !== undefined) {
      clearTimeout(task.retryTimeout);
    }

    const queueIndex = this.queue.indexOf(task);
    if (queueIndex >= 0) {
      this.queue.splice(queueIndex, 1);
    }
    this.activeTasks = this.activeTasks.filter(x => x !== task);

    task.reject(task.signal ? abortReason(task.signal) : new Error('Task aborted'));
    // Free the slot the task held (or would have held) so the pool keeps draining.
    this.processPool(task.pool);
    this.tryToSettlePool(task.pool);
  }

  private processPool(pool: string) {
    let task: Task | null = null;

    const activeTasks = this.activeTasks.filter(x => x.pool === pool);
    // skip this iteration since task pool at full capacity
    if (activeTasks.length >= this.config.poolSize) {
      return;
    }

    // finding the next task
    for (const [index, potentialTask] of this.queue.entries()) {
      if (potentialTask.pool !== pool) {
        continue;
      }

      task = potentialTask;
      this.queue.splice(index, 1);
      break;
    }

    if (nullable(task)) {
      return;
    }

    this.activeTasks.push(task);

    const handleError = (task: Task, error: Error) => {
      // The task was already rejected by abortTask; don't reject again or schedule a retry.
      if (task.signal?.aborted) {
        return;
      }

      if (task.retry >= this.config.retryCount) {
        task.reject(error);
      } else {
        const retryDelay = this.retryDelay(task);

        task.retry++;
        task.retryTimeout = setTimeout(() => {
          this.queue.push(task);
          this.processPool(pool);
        }, retryDelay);
      }
    };

    const finish = (task: Task) => {
      this.activeTasks = this.activeTasks.filter(x => x !== task);
      this.tryToSettlePool(pool);
      this.processPool(pool);
    };

    try {
      task
        .fn()
        .andTee(result => {
          task.resolve(result);
          finish(task);
        })
        .orTee(error => {
          handleError(task, error);
          finish(task);
        });
    } catch (error) {
      handleError(task, toError(error));
      finish(task);
    }
  }

  private tryToSettlePool(pool: string) {
    const activePoolTasks = this.activeTasks.find(x => x.pool === pool);
    const queuedPoolTasks = this.queue.find(x => x.pool === pool);

    if (nullable(activePoolTasks) && nullable(queuedPoolTasks)) {
      this.events.emit('settled', pool);
    }
  }

  private retryDelay(task: Task) {
    return typeof this.config.retryDelay === 'function' ? this.config.retryDelay(task.retry) : this.config.retryDelay;
  }
}

export const createAsyncTaskPool = (params: Params) => new AsyncTaskPool(params);
