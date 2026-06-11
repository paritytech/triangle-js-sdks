import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PRIORITY_EPOCH_OFFSET, createExpiryAllocator } from './allocator.js';

const NOW_SECS = 1_790_000_000; // 2026-09-22, safely past the 2025-11-15 priority epoch

describe('createExpiryAllocator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECS * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pins the high 32 bits to 0xFFFFFFFF and counts the low word from the priority epoch', () => {
    const allocator = createExpiryAllocator();

    const expiry = allocator.next();

    expect(expiry >> 32n).toBe(0xffff_ffffn);
    expect(expiry & 0xffff_ffffn).toBe(BigInt(NOW_SECS) - PRIORITY_EPOCH_OFFSET);
  });

  it('is strictly monotonic within the same second', () => {
    const allocator = createExpiryAllocator();

    const first = allocator.next();
    const second = allocator.next();

    expect(second).toBe(first + 1n);
  });

  it('jumps above a raised floor so the next submit clears the chain minimum', () => {
    const allocator = createExpiryAllocator();
    const chainMin = (0xffff_ffffn << 32n) | 4_000_000_000n; // a poisoned account's minimum

    allocator.raiseFloor(chainMin);

    expect(allocator.next()).toBeGreaterThan(chainMin);
  });

  it('ignores a floor below the current value', () => {
    const allocator = createExpiryAllocator();
    const before = allocator.next();

    allocator.raiseFloor(0n);

    expect(allocator.next()).toBeGreaterThan(before);
  });

  it('keeps independent instances independent', () => {
    const a = createExpiryAllocator();
    const b = createExpiryAllocator();

    a.raiseFloor((0xffff_ffffn << 32n) | 4_000_000_000n);

    expect(b.next() & 0xffff_ffffn).toBe(BigInt(NOW_SECS) - PRIORITY_EPOCH_OFFSET);
  });
});
