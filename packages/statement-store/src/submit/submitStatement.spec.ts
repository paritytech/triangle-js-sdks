import type { Statement } from '@novasamatech/sdk-statement';
import { errAsync, okAsync } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StatementStoreAdapter } from '../adapter/types.js';
import { AccountFullError } from '../adapter/types.js';
import type { StatementProver } from '../session/statementProver.js';

import { createExpiryAllocator } from './allocator.js';
import { signAndSubmitStatement, submitStatementOnce } from './submitStatement.js';

const NOW_SECS = 1_790_000_000;

// Passthrough prover: "signs" by returning the statement unchanged.
const fakeProver = {
  generateMessageProof: (stmt: Statement) => okAsync(stmt),
} as unknown as StatementProver;

function makeStore(failFirstWithMin?: bigint) {
  const submitted: Statement[] = [];
  let calls = 0;
  const adapter = {
    submitStatement: vi.fn((stmt: Statement) => {
      submitted.push(stmt);
      calls += 1;
      return failFirstWithMin !== undefined && calls === 1
        ? errAsync(new AccountFullError(stmt.expiry ?? 0n, failFirstWithMin))
        : okAsync(undefined);
    }),
  } as unknown as StatementStoreAdapter;
  return { adapter, submitted };
}

const baseParams = (adapter: StatementStoreAdapter) => ({
  statementStore: adapter,
  prover: fakeProver,
  allocator: createExpiryAllocator(),
  channel: new Uint8Array(32),
  topics: [new Uint8Array(32)],
  data: new Uint8Array([1]),
});

describe('submitStatementOnce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECS * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('submits with the pinned-high expiry layout', async () => {
    const { adapter, submitted } = makeStore();

    const result = await submitStatementOnce(baseParams(adapter));

    expect(result.isOk()).toBe(true);
    expect(submitted).toHaveLength(1);
    expect((submitted[0]!.expiry ?? 0n) >> 32n).toBe(0xffff_ffffn);
  });

  it('raises the allocator floor on a priority rejection so the next attempt clears the minimum', async () => {
    const chainMin = (0xffff_ffffn << 32n) | 4_000_000_000n;
    const { adapter, submitted } = makeStore(chainMin);
    const params = baseParams(adapter);

    const first = await submitStatementOnce(params);
    const second = await submitStatementOnce(params);

    expect(first.isErr()).toBe(true);
    expect(second.isOk()).toBe(true);
    expect(submitted[1]!.expiry ?? 0n).toBeGreaterThan(chainMin); // adopted min, not wall clock
  });
});

describe('signAndSubmitStatement', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECS * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a priority rejection above the chain-reported minimum within the priority budget', async () => {
    const chainMin = (0xffff_ffffn << 32n) | 4_000_000_000n;
    const { adapter, submitted } = makeStore(chainMin);

    const promise = signAndSubmitStatement({
      ...baseParams(adapter),
      retry: { attempts: 0, priorityAttempts: 3, delaysMs: [500, 1500, 3000] },
    });
    await vi.advanceTimersByTimeAsync(600); // cover the 500ms first backoff
    const result = await promise;

    expect(result.isOk()).toBe(true);
    expect(submitted).toHaveLength(2);
    expect(submitted[1]!.expiry ?? 0n).toBeGreaterThan(chainMin);
  });

  it('propagates after exhausting the priority budget on a persistent rejection', async () => {
    const submitted: Statement[] = [];
    const adapter = {
      submitStatement: vi.fn((stmt: Statement) => {
        submitted.push(stmt);
        // Chain min keeps rising above whatever we submit — never lands.
        return errAsync(new AccountFullError(stmt.expiry ?? 0n, (stmt.expiry ?? 0n) + 1_000_000n));
      }),
    } as unknown as StatementStoreAdapter;

    const promise = signAndSubmitStatement({
      ...baseParams(adapter),
      retry: { attempts: 0, priorityAttempts: 3, delaysMs: 1 },
    });
    await vi.advanceTimersByTimeAsync(50);
    const result = await promise;

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(AccountFullError);
    expect(submitted).toHaveLength(4); // 1 initial + 3 priority retries
  });
});
