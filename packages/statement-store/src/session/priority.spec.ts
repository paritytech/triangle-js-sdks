import { describe, expect, it, vi } from 'vitest';

import { nextExpiry } from './priority.js';

// Statement expiry/priority: u64 = (expiration_epoch << 32) | priority. The high word is pinned
// to 0xFFFFFFFF (non-expiring) and the low word is a wall-clock-floored monotonic priority that
// drives channel supersession. (Spec §1; matches iOS/Android.)
describe('expiry priority', () => {
  it('encodes a non-expiring statement (high word pinned to 0xFFFFFFFF)', () => {
    expect(nextExpiry(0n) >> 32n).toBe(0xffff_ffffn);
  });

  it('carries a wall-clock priority in the low word', () => {
    const result = nextExpiry(0n);
    expect(result & 0xffff_ffffn).toBeGreaterThan(0n);
  });

  it('counts the low word from the 2025-11-15 priority epoch (matches iOS/Android)', () => {
    // iOS StatementPriorityFactory: priority = unixSeconds - 1_763_164_800 (the 2025-11-15 base,
    // spec §1). The TS SDK must use the SAME base; otherwise its low word is ~1.76e9 larger than
    // every mobile client's, so any cross-client/shared-channel priority comparison would rank a
    // TS-written statement above a mobile-written one regardless of real time.
    const PRIORITY_EPOCH_OFFSET = 1_763_164_800n;
    vi.useFakeTimers();
    try {
      const fixedMs = 1_780_000_000_000;
      vi.setSystemTime(fixedMs);
      const expected = BigInt(Math.floor(fixedMs / 1000)) - PRIORITY_EPOCH_OFFSET;
      expect(nextExpiry(0n) & 0xffff_ffffn).toBe(expected);
    } finally {
      vi.useRealTimers();
    }
  });

  it('increments by one when the current value already exceeds the wall-clock priority', () => {
    const high = (0xffff_ffffn << 32n) | 0xffff_ffffn; // max u64
    expect(nextExpiry(high)).toBe(high + 1n);
  });

  it('is strictly monotonic across repeated calls', () => {
    let expiry = 0n;
    for (let i = 0; i < 5; i++) {
      const next = nextExpiry(expiry);
      expect(next).toBeGreaterThan(expiry);
      expiry = next;
    }
  });
});
