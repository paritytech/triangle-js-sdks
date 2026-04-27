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
};

type TaskParams = { pool?: string; signal?: AbortSignal };

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
    const task: Task<T> = {
      fn,
      pool: params?.pool ?? DEFAULT_POOL,
      retry: 0,
      resolve,
      reject,
      signal: params?.signal,
    };

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
      if (task.retry >= this.config.retryCount) {
        task.reject(error);
      } else {
        if (task.signal?.aborted) {
          task.reject(error);
          return;
        }

        const retryDelay = this.retryDelay(task);

        task.retry++;
        setTimeout(() => {
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
