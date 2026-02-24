import { GenericError } from '@novasamatech/host-api';

export const RATE_LIMITED_MESSAGE = 'Request rate limited';

export type RateLimiterConfig = {
  maxRequestsPerInterval: number;
  intervalMs: number;
  maxQueuedRequests: number;
  onDrop?(): unknown;
};

export type RateLimiterStrategy = 'queue' | 'drop';

export type CreateRateLimiterConfig = RateLimiterConfig & {
  strategy: RateLimiterStrategy;
  onDrop?(): unknown;
};

type QueuedTask<T = unknown> = {
  execute: () => T | Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

type TokenBucketState = {
  remainingTokens: number;
  lastRefillTimestamp: number;
  queue: QueuedTask<unknown>[];
  timerId: ReturnType<typeof setTimeout> | null;
};

export type RateLimiter = {
  schedule<T>(execute: () => T | Promise<T>): Promise<T>;
  destroy(): void;
};

function createQueueStrategy(config: CreateRateLimiterConfig): RateLimiter {
  const state: TokenBucketState = {
    remainingTokens: config.maxRequestsPerInterval,
    lastRefillTimestamp: Date.now(),
    queue: [],
    timerId: null,
  };

  function refillTokens() {
    const now = Date.now();
    const elapsed = now - state.lastRefillTimestamp;

    if (elapsed <= 0) return;
    if (elapsed >= config.intervalMs) {
      state.remainingTokens = config.maxRequestsPerInterval;
      state.lastRefillTimestamp = now;
    }
  }

  function processQueue() {
    state.timerId = null;
    refillTokens();

    while (state.remainingTokens > 0 && state.queue.length > 0) {
      const task = state.queue.shift()!;
      state.remainingTokens -= 1;

      try {
        const result = task.execute();
        if (result != null && typeof (result as Promise<unknown>).then === 'function') {
          (result as Promise<unknown>).then(task.resolve).catch(task.reject);
        } else {
          task.resolve(result);
        }
      } catch (error) {
        task.reject(error);
      }
    }

    if (state.queue.length > 0) {
      state.timerId = setTimeout(processQueue, Math.floor(config.intervalMs / 2));
    }
  }

  function ensureProcessingScheduled() {
    if (state.timerId !== null) return;
    state.timerId = setTimeout(processQueue, Math.floor(config.intervalMs / 2));
  }

  function schedule<T>(execute: () => T | Promise<T>): Promise<T> {
    refillTokens();

    if (state.remainingTokens > 0 && state.queue.length === 0) {
      state.remainingTokens -= 1;
      try {
        const result = execute();
        if (result != null && typeof (result as Promise<T>).then === 'function') {
          return result as Promise<T>;
        }
        return Promise.resolve(result as T);
      } catch (error) {
        return Promise.reject(error);
      }
    }

    if (state.queue.length >= config.maxQueuedRequests) {
      return Promise.reject(config.onDrop?.() ?? new GenericError({ reason: RATE_LIMITED_MESSAGE }));
    }

    return new Promise<T>((resolve, reject) => {
      state.queue.push({
        execute: execute as () => unknown | Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      ensureProcessingScheduled();
    });
  }

  function destroy() {
    if (state.timerId !== null) {
      clearTimeout(state.timerId);
      state.timerId = null;
    }
    while (state.queue.length > 0) {
      const task = state.queue.shift()!;
      task.reject(config.onDrop?.() ?? new GenericError({ reason: RATE_LIMITED_MESSAGE }));
    }
  }

  return { schedule, destroy };
}

function createDropStrategy(config: CreateRateLimiterConfig): RateLimiter {
  const state = {
    remainingTokens: config.maxRequestsPerInterval,
    lastRefillTimestamp: Date.now(),
  };

  const refillTokens = () => {
    const now = Date.now();
    const elapsed = now - state.lastRefillTimestamp;
    if (elapsed >= config.intervalMs) {
      state.remainingTokens = config.maxRequestsPerInterval;
      state.lastRefillTimestamp = now;
    }
  };

  const schedule = <T>(execute: () => T | Promise<T>): Promise<T> => {
    refillTokens();
    if (state.remainingTokens > 0) {
      state.remainingTokens -= 1;
      try {
        const result = execute();
        if (result != null && typeof (result as Promise<T>).then === 'function') {
          return result as Promise<T>;
        }
        return Promise.resolve(result as T);
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return Promise.reject(config.onDrop?.() ?? new GenericError({ reason: RATE_LIMITED_MESSAGE }));
  };

  return {
    schedule,
    destroy: () => {
      /* no-op: drop strategy has no timers or queue */
    },
  };
}

export function createRateLimiter(config: CreateRateLimiterConfig): RateLimiter {
  if (config.strategy === 'queue') {
    return createQueueStrategy(config);
  }
  return createDropStrategy(config);
}
