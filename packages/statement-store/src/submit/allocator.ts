/**
 * Statement expiry/priority, u64 = (expiration_epoch << 32) | priority (spec layout).
 * We pin the high word to 0xFFFFFFFF (max → effectively non-expiring, matching iOS &
 * Android) and use the low word as a wall-clock-floored monotonic priority, so channel
 * supersession is driven by the priority regardless of how the store compares the field.
 */
const NEVER_EXPIRE_HIGH = 0xffffffffn;
/**
 * Priority epoch base: seconds at 2025-11-15T00:00:00Z. The low word is a u32 priority counted FROM
 * this epoch (spec §1), not the raw Unix timestamp. iOS (StatementPriorityFactory.unixOffset) and
 * Android subtract the same offset; omitting it makes the TS low word ~1.76e9 larger than every
 * mobile client's, so any cross-client or shared-channel priority comparison would always rank a
 * TS-written statement above a mobile-written one. Keeping the base aligned removes that landmine.
 */
export const PRIORITY_EPOCH_OFFSET = 1_763_164_800n;

/** Returns a value strictly greater than `current` (i.e. `max(current + 1, now-priority)`). */
function nextExpiry(current: bigint): bigint {
  const nowSecs = BigInt(Math.floor(Date.now() / 1000));
  const priority = nowSecs > PRIORITY_EPOCH_OFFSET ? nowSecs - PRIORITY_EPOCH_OFFSET : 0n;
  const timestampPriority = (NEVER_EXPIRE_HIGH << 32n) | priority;
  return timestampPriority > current ? timestampPriority : current + 1n;
}

/**
 * Strictly-increasing source of statement expiries for one signing account,
 * with a floor that can be raised to a chain-reported minimum.
 *
 * Layout: u64 = (0xFFFFFFFF << 32) | priority — see the module doc above.
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
