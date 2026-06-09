/**
 * Statement expiry/priority, u64 = (expiration_epoch << 32) | priority (spec layout).
 * We pin the high word to 0xFFFFFFFF (max → effectively non-expiring, matching iOS &
 * Android) and use the low word as a wall-clock-floored monotonic priority, so channel
 * supersession is driven by the priority regardless of how the store compares the field.
 * Returns a value strictly greater than `current` (i.e. `max(current + 1, now-priority)`).
 */
const NEVER_EXPIRE_HIGH = 0xffffffffn;
/**
 * Priority epoch base: seconds at 2025-11-15T00:00:00Z. The low word is a u32 priority counted FROM
 * this epoch (spec §1), not the raw Unix timestamp. iOS (StatementPriorityFactory.unixOffset) and
 * Android subtract the same offset; omitting it makes the TS low word ~1.76e9 larger than every
 * mobile client's, so any cross-client or shared-channel priority comparison would always rank a
 * TS-written statement above a mobile-written one. Keeping the base aligned removes that landmine.
 */
const PRIORITY_EPOCH_OFFSET = 1_763_164_800n;

export function nextExpiry(current: bigint): bigint {
  const nowSecs = BigInt(Math.floor(Date.now() / 1000));
  const priority = nowSecs > PRIORITY_EPOCH_OFFSET ? nowSecs - PRIORITY_EPOCH_OFFSET : 0n;
  const timestampPriority = (NEVER_EXPIRE_HIGH << 32n) | priority;
  return timestampPriority > current ? timestampPriority : current + 1n;
}
