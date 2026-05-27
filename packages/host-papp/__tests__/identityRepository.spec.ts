import type { StorageAdapter } from '@novasamatech/storage-adapter';
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

function makeRepo(adapter: IdentityAdapter, storage: StorageAdapter = createMemoryAdapter()) {
  return createIdentityRepository({ adapter, storage, initialEmissionTimeoutMs: TIMEOUT_MS });
}

async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
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
    const repo = makeRepo(makeAdapter(source));

    const emissions: (Identity | null)[] = [];
    repo.watchIdentity('acc-1').subscribe(v => emissions.push(v));

    source.next(lite());
    source.next(person());

    expect(emissions).toEqual([lite(), person()]);
  });

  it('collapses identical consecutive emissions via distinctUntilChanged', () => {
    const source = new Subject<Identity | null>();
    const repo = makeRepo(makeAdapter(source));

    const emissions: (Identity | null)[] = [];
    repo.watchIdentity('acc-1').subscribe(v => emissions.push(v));

    source.next(lite());
    source.next({ ...lite() }); // structurally equal but new ref
    source.next(person());

    expect(emissions).toEqual([lite(), person()]);
  });

  it('writes each distinct non-null emission through to storage', () => {
    const source = new Subject<Identity | null>();
    const storage = createMemoryAdapter();
    const writeSpy = vi.spyOn(storage, 'write');
    const repo = makeRepo(makeAdapter(source), storage);

    repo.watchIdentity('acc-1').subscribe();

    source.next(lite());
    source.next(person());

    expect(writeSpy).toHaveBeenCalledTimes(2);
    expect(writeSpy).toHaveBeenLastCalledWith('identity_acc-1', JSON.stringify(person()));
  });

  it('does not write a null emission through to storage', () => {
    const source = new Subject<Identity | null>();
    const storage = createMemoryAdapter();
    const writeSpy = vi.spyOn(storage, 'write');
    const repo = makeRepo(makeAdapter(source), storage);

    repo.watchIdentity('acc-1').subscribe();
    source.next(null);

    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('emits null after the initial-emission timeout when the source is silent', () => {
    const source = new Subject<Identity | null>();
    const repo = makeRepo(makeAdapter(source));

    const emissions: (Identity | null)[] = [];
    repo.watchIdentity('acc-1').subscribe(v => emissions.push(v));

    vi.advanceTimersByTime(TIMEOUT_MS);

    expect(emissions).toEqual([null]);
  });

  it('cancels the fallback once the source emits first', () => {
    const source = new Subject<Identity | null>();
    const repo = makeRepo(makeAdapter(source));

    const emissions: (Identity | null)[] = [];
    repo.watchIdentity('acc-1').subscribe(v => emissions.push(v));

    source.next(person());
    vi.advanceTimersByTime(TIMEOUT_MS * 2);

    expect(emissions).toEqual([person()]);
  });

  it('still emits real chain values that arrive after the fallback null', () => {
    const source = new Subject<Identity | null>();
    const repo = makeRepo(makeAdapter(source));

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
    const repo = makeRepo(adapter);

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
    const repo = makeRepo(makeAdapter(new Subject<Identity | null>()), storage);

    const emissions: (Identity | null)[] = [];
    repo.watchIdentity('acc-1').subscribe(v => emissions.push(v));

    await flushMicrotasks();

    expect(emissions).toEqual([cached]);
  });

  it('does not emit a premature null from an empty cache before the fallback fires', async () => {
    const storage = createMemoryAdapter(); // cold cache
    const repo = makeRepo(makeAdapter(new Subject<Identity | null>()), storage);

    const emissions: (Identity | null)[] = [];
    repo.watchIdentity('acc-1').subscribe(v => emissions.push(v));
    await flushMicrotasks();

    // The empty-cache seed is filtered out, so nothing is emitted yet — the
    // fallback timer stays armed instead of being cancelled by a stray null.
    expect(emissions).toEqual([]);

    vi.advanceTimersByTime(TIMEOUT_MS);
    expect(emissions).toEqual([null]);
  });

  it('reads storage only once per watch subscription', async () => {
    const storage = createMemoryAdapter({ 'identity_acc-1': JSON.stringify(person()) });
    const readSpy = vi.spyOn(storage, 'read');
    const repo = makeRepo(makeAdapter(new Subject<Identity | null>()), storage);

    repo.watchIdentity('acc-1').subscribe();
    await flushMicrotasks();

    // The seed read is shared, not duplicated by the fallback's takeUntil.
    expect(readSpy).toHaveBeenCalledTimes(1);
  });

  it('drops the cache seed if the live chain emits first', async () => {
    const cached = person('acc-1', 'cached-name');
    const storage = createMemoryAdapter({ 'identity_acc-1': JSON.stringify(cached) });
    const source = new Subject<Identity | null>();
    const repo = makeRepo(makeAdapter(source), storage);

    const emissions: (Identity | null)[] = [];
    repo.watchIdentity('acc-1').subscribe(v => emissions.push(v));

    source.next(person('acc-1', 'chain-name'));
    await flushMicrotasks();

    expect(emissions).toEqual([person('acc-1', 'chain-name')]);
  });

  it('returns the same Observable for repeated watchIdentity(acc) calls', () => {
    const repo = makeRepo(makeAdapter(new Subject<Identity | null>()));

    expect(repo.watchIdentity('acc-1')).toBe(repo.watchIdentity('acc-1'));
    expect(repo.watchIdentity('acc-1')).not.toBe(repo.watchIdentity('acc-2'));
  });

  it('drops the cache entry once the last subscriber unsubscribes', () => {
    const repo = makeRepo(makeAdapter(new Subject<Identity | null>()));

    const first = repo.watchIdentity('acc-1');
    const sub = first.subscribe();
    // Shared while a subscriber is live.
    expect(repo.watchIdentity('acc-1')).toBe(first);

    sub.unsubscribe();
    // refCount → 0 tears the stream down and finalize removes the map entry,
    // so the next watch builds a fresh stream rather than reusing a dead one.
    expect(repo.watchIdentity('acc-1')).not.toBe(first);
  });

  it('does not evict a fresh entry when a torn-down stream is re-subscribed', () => {
    const repo = makeRepo(makeAdapter(new Subject<Identity | null>()));

    const streamA = repo.watchIdentity('acc-1');
    streamA.subscribe().unsubscribe(); // refCount → 0 evicts streamA

    const streamB = repo.watchIdentity('acc-1'); // fresh entry for the same account
    expect(streamB).not.toBe(streamA);

    // Re-subscribe + tear down the STALE streamA; its finalize must not delete
    // streamB's entry just because it shares the account key.
    streamA.subscribe().unsubscribe();

    expect(repo.watchIdentity('acc-1')).toBe(streamB);
  });

  it('treats two structurally-equal Identity objects as equal even if a new field is added', () => {
    const source = new Subject<Identity | null>();
    const repo = makeRepo(makeAdapter(source));

    const emissions: (Identity | null)[] = [];
    repo.watchIdentity('acc-1').subscribe(v => emissions.push(v));

    // Future Identity field must not bypass distinctUntilChanged.
    const widened = { ...person(), avatarUrl: 'https://example/a.png' } as unknown as Identity;
    source.next(widened);
    source.next({ ...person(), avatarUrl: 'https://example/a.png' } as unknown as Identity);

    expect(emissions).toEqual([widened]);
  });
});
