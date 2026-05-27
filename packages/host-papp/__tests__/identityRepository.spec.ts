import { createMemoryAdapter } from '@novasamatech/storage-adapter';
import { errAsync, okAsync } from 'neverthrow';
import { Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createIdentityRepository } from '../src/identity/impl.js';
import type { Identity, IdentityAdapter } from '../src/identity/types.js';

const TIMEOUT_MS = 100;

function lite(accountId = 'acc-1', liteUsername = 'alice.01'): Identity {
  return { accountId, fullUsername: null, liteUsername, credibility: { type: 'Lite' } };
}

function person(accountId = 'acc-1', fullUsername = 'alice'): Identity {
  return {
    accountId,
    fullUsername,
    liteUsername: 'alice.01',
    credibility: { type: 'Person', alias: '0xdeadbeef', lastUpdate: '42' },
  };
}

function makeAdapter(stream: Subject<Identity | null>): IdentityAdapter {
  return {
    readIdentities: vi.fn(() => okAsync({})),
    watchIdentity: vi.fn(() => stream.asObservable()),
  };
}

describe('createIdentityRepository.watchIdentity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('forwards each chain emission to the subscriber', () => {
    const source = new Subject<Identity | null>();
    const storage = createMemoryAdapter();
    const repo = createIdentityRepository({
      adapter: makeAdapter(source),
      storage,
      initialEmissionTimeoutMs: TIMEOUT_MS,
    });

    const emissions: (Identity | null)[] = [];
    repo.watchIdentity('acc-1').subscribe(v => emissions.push(v));

    source.next(lite());
    source.next(person());

    expect(emissions).toEqual([lite(), person()]);
  });

  it('collapses identical consecutive emissions via distinctUntilChanged', () => {
    const source = new Subject<Identity | null>();
    const storage = createMemoryAdapter();
    const repo = createIdentityRepository({
      adapter: makeAdapter(source),
      storage,
      initialEmissionTimeoutMs: TIMEOUT_MS,
    });

    const emissions: (Identity | null)[] = [];
    repo.watchIdentity('acc-1').subscribe(v => emissions.push(v));

    source.next(lite());
    source.next({ ...lite() }); // structurally equal but new ref
    source.next(person());

    expect(emissions).toEqual([lite(), person()]);
  });

  it('writes each distinct non-null emission through to storage', async () => {
    const source = new Subject<Identity | null>();
    const writes: Record<string, string> = {};
    const storage = {
      read: vi.fn(() => okAsync(null)),
      write: vi.fn((key: string, value: string) => {
        writes[key] = value;
        return okAsync<void>(undefined);
      }),
      remove: vi.fn(() => okAsync<void>(undefined)),
    };
    const repo = createIdentityRepository({
      adapter: makeAdapter(source),
      storage,
      initialEmissionTimeoutMs: TIMEOUT_MS,
    });

    repo.watchIdentity('acc-1').subscribe();

    source.next(lite());
    source.next(person());

    expect(storage.write).toHaveBeenCalledTimes(2);
    expect(JSON.parse(writes['identity_acc-1']!)).toEqual(person());
  });

  it('does not write a null emission through to storage', () => {
    const source = new Subject<Identity | null>();
    const storage = {
      read: vi.fn(() => okAsync(null)),
      write: vi.fn(() => okAsync<void>(undefined)),
      remove: vi.fn(() => okAsync<void>(undefined)),
    };
    const repo = createIdentityRepository({
      adapter: makeAdapter(source),
      storage,
      initialEmissionTimeoutMs: TIMEOUT_MS,
    });

    repo.watchIdentity('acc-1').subscribe();
    source.next(null);

    expect(storage.write).not.toHaveBeenCalled();
  });

  it('emits null after the initial-emission timeout when the source is silent', () => {
    const source = new Subject<Identity | null>();
    const storage = createMemoryAdapter();
    const repo = createIdentityRepository({
      adapter: makeAdapter(source),
      storage,
      initialEmissionTimeoutMs: TIMEOUT_MS,
    });

    const emissions: (Identity | null)[] = [];
    repo.watchIdentity('acc-1').subscribe(v => emissions.push(v));

    vi.advanceTimersByTime(TIMEOUT_MS);

    expect(emissions).toEqual([null]);
  });

  it('cancels the fallback once the source emits first', () => {
    const source = new Subject<Identity | null>();
    const storage = createMemoryAdapter();
    const repo = createIdentityRepository({
      adapter: makeAdapter(source),
      storage,
      initialEmissionTimeoutMs: TIMEOUT_MS,
    });

    const emissions: (Identity | null)[] = [];
    repo.watchIdentity('acc-1').subscribe(v => emissions.push(v));

    source.next(person());
    vi.advanceTimersByTime(TIMEOUT_MS * 2);

    expect(emissions).toEqual([person()]);
  });

  it('still emits real chain values that arrive after the fallback null', () => {
    const source = new Subject<Identity | null>();
    const storage = createMemoryAdapter();
    const repo = createIdentityRepository({
      adapter: makeAdapter(source),
      storage,
      initialEmissionTimeoutMs: TIMEOUT_MS,
    });

    const emissions: (Identity | null)[] = [];
    repo.watchIdentity('acc-1').subscribe(v => emissions.push(v));

    vi.advanceTimersByTime(TIMEOUT_MS);
    source.next(person());

    expect(emissions).toEqual([null, person()]);
  });

  it('forwards adapter errors to the subscriber', () => {
    const adapter: IdentityAdapter = {
      readIdentities: vi.fn(() => errAsync(new Error('rpc'))),
      watchIdentity: vi.fn(() => throwError(() => new Error('pallet missing'))),
    };
    const repo = createIdentityRepository({
      adapter,
      storage: createMemoryAdapter(),
      initialEmissionTimeoutMs: TIMEOUT_MS,
    });

    const errors: Error[] = [];
    repo.watchIdentity('acc-1').subscribe({
      error: e => errors.push(e),
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('pallet missing');
  });

  it('emits a cached identity as the first value when the chain is silent', async () => {
    const cached = person('acc-1', 'cached-name');
    const storage = createMemoryAdapter({ 'identity_acc-1': JSON.stringify(cached) });
    const source = new Subject<Identity | null>();
    const repo = createIdentityRepository({
      adapter: makeAdapter(source),
      storage,
      initialEmissionTimeoutMs: TIMEOUT_MS,
    });

    const emissions: (Identity | null)[] = [];
    repo.watchIdentity('acc-1').subscribe(v => emissions.push(v));

    // Flush microtasks the cache read sits on (defer → Promise → from).
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(emissions).toEqual([cached]);
  });

  it('drops the cache seed if the live chain emits first', async () => {
    const cached = person('acc-1', 'cached-name');
    const storage = createMemoryAdapter({ 'identity_acc-1': JSON.stringify(cached) });
    const source = new Subject<Identity | null>();
    const repo = createIdentityRepository({
      adapter: makeAdapter(source),
      storage,
      initialEmissionTimeoutMs: TIMEOUT_MS,
    });

    const emissions: (Identity | null)[] = [];
    repo.watchIdentity('acc-1').subscribe(v => emissions.push(v));

    // Live beats the (async) cache read.
    source.next(person('acc-1', 'chain-name'));
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(emissions).toEqual([person('acc-1', 'chain-name')]);
  });

  it('returns the same Observable for repeated watchIdentity(acc) calls', () => {
    const storage = createMemoryAdapter();
    const repo = createIdentityRepository({
      adapter: makeAdapter(new Subject<Identity | null>()),
      storage,
      initialEmissionTimeoutMs: TIMEOUT_MS,
    });

    expect(repo.watchIdentity('acc-1')).toBe(repo.watchIdentity('acc-1'));
    expect(repo.watchIdentity('acc-1')).not.toBe(repo.watchIdentity('acc-2'));
  });

  it('treats two structurally-equal Identity objects as equal even if a new field is added', () => {
    const source = new Subject<Identity | null>();
    const storage = createMemoryAdapter();
    const repo = createIdentityRepository({
      adapter: makeAdapter(source),
      storage,
      initialEmissionTimeoutMs: TIMEOUT_MS,
    });

    const emissions: (Identity | null)[] = [];
    repo.watchIdentity('acc-1').subscribe(v => emissions.push(v));

    // Simulate a future field on Identity by widening the value passed
    // through the adapter. Structural equality must still dedupe identical
    // payloads so a future schema extension doesn't silently bypass
    // distinctUntilChanged.
    const widened = { ...person(), avatarUrl: 'https://example/a.png' } as unknown as Identity;
    source.next(widened);
    source.next({ ...person(), avatarUrl: 'https://example/a.png' } as unknown as Identity);

    expect(emissions).toEqual([widened]);
  });
});
