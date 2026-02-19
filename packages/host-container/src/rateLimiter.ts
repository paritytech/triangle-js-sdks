export type RateLimiterConfig = {
  /**
   * Maximum number of requests that can be executed within one interval when the queue is empty.
   */
  maxRequestsPerInterval: number;
  /**
   * Interval duration for refilling tokens, in milliseconds.
   */
  intervalMs: number;
  /**
   * Maximum number of requests to hold in the queue.
   */
  maxQueuedRequests: number;
  /**
   * Maximum time a request may wait in the queue.
   * If it waits longer, it fails with an error.
   */
  maxQueueDelayMs: number;
};

export type RateLimiterErrorCode = 'rate_limited' | 'timeout_in_queue';

export class RateLimiterError extends Error {
  public readonly code: RateLimiterErrorCode;

  constructor(code: RateLimiterErrorCode) {
    super(code);
    this.code = code;
    this.name = 'RateLimiterError';
  }
}

type QueuedTask<T = unknown> = {
  createdAt: number;
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

export type TokenBucketRateLimiter = {
  /**
   * Schedules task execution subject to rate limits.
   * If the limit is exhausted, the task is queued.
   * If the queue is full or the task waits too long,
   * the promise is rejected with RateLimiterError.
   */
  schedule<T>(execute: () => T | Promise<T>): Promise<T>;
  /**
   * Cleans up internal state: queue and timers.
   * All pending tasks are rejected with timeout_in_queue.
   */
  destroy(): void;
};

export function createTokenBucketRateLimiter(config: RateLimiterConfig): TokenBucketRateLimiter {
  const state: TokenBucketState = {
    remainingTokens: config.maxRequestsPerInterval,
    lastRefillTimestamp: Date.now(),
    queue: [],
    timerId: null,
  };

  function refillTokens() {
    const now = Date.now();
    const elapsed = now - state.lastRefillTimestamp;

    if (elapsed <= 0) {
      return;
    }

    if (elapsed >= config.intervalMs) {
      state.remainingTokens = config.maxRequestsPerInterval;
      state.lastRefillTimestamp = now;
    }
  }

  function processQueue() {
    state.timerId = null;
    refillTokens();

    const now = Date.now();

    while (state.remainingTokens > 0 && state.queue.length > 0) {
      const task = state.queue[0]!;

      if (now - task.createdAt > config.maxQueueDelayMs) {
        state.queue.shift();
        task.reject(new RateLimiterError('timeout_in_queue'));
        continue;
      }

      state.queue.shift();
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
    if (state.timerId !== null) {
      return;
    }

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
      return Promise.reject(new RateLimiterError('rate_limited'));
    }

    return new Promise<T>((resolve, reject) => {
      state.queue.push({
        createdAt: Date.now(),
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
      task.reject(new RateLimiterError('timeout_in_queue'));
    }
  }

  return {
    schedule,
    destroy,
  };
}
