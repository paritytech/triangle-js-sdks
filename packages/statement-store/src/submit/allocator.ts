import { nextExpiry } from '../session/priority.js';

/**
 * Strictly-increasing source of statement expiries for one signing account,
 * with a floor that can be raised to a chain-reported minimum.
 *
 * Layout: u64 = (0xFFFFFFFF << 32) | priority — see `session/priority.ts`.
 * Supersession and account-quota eviction compare the whole u64 with
 * strictly-greater semantics, so every writer signing with the SAME account
 * must draw from ONE allocator instance: independent counters produce
 * same-second priority ties that the store rejects.
 */
export type ExpiryAllocator = {
  /** Next expiry: wall-clock-floored priority, bumped to stay strictly increasing. */
  next(): bigint;
  /**
   * Adopt a chain-reported minimum (`AccountFullError` / `ExpiryTooLowError`
   * `.min`, or the max expiry seen in channel history) so the next `next()`
   * clears it. The chain is the source of truth for the floor; recomputing
   * from the wall clock can never clear a pinned-high minimum.
   */
  raiseFloor(min: bigint): void;
};

export function createExpiryAllocator(): ExpiryAllocator {
  let current = 0n;
  return {
    next() {
      current = nextExpiry(current);
      return current;
    },
    raiseFloor(min) {
      if (min > current) current = min;
    },
  };
}
