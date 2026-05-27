import type { StorageAdapter } from '@novasamatech/storage-adapter';
import { Result, ResultAsync, err, ok, okAsync } from 'neverthrow';
import type { Observable } from 'rxjs';
import { defer, distinctUntilChanged, filter, finalize, map, merge, shareReplay, takeUntil, tap, timer } from 'rxjs';

import { toError } from '../helpers/utils.js';

import type { Identity, IdentityAdapter, IdentityRepository } from './types.js';

const WATCH_IDENTITY_INITIAL_TIMEOUT_MS = 15_000;

function getCacheKey(accountId: string): string {
  return `identity_${accountId}`;
}

function parseIdentity(raw: string | null): Identity | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Identity;
  } catch {
    return null;
  }
}

// Identity values are produced by `decodeRawIdentity` only, so key order is
// deterministic and JSON.stringify is a safe structural equality probe.
function identitiesEqual(a: Identity | null, b: Identity | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function readCachedIdentity(storage: StorageAdapter, accountId: string): Observable<Identity | null> {
  return defer(() => storage.read(getCacheKey(accountId)).match(parseIdentity, () => null));
}

export function createIdentityRepository({
  adapter,
  storage,
  initialEmissionTimeoutMs = WATCH_IDENTITY_INITIAL_TIMEOUT_MS,
}: {
  adapter: IdentityAdapter;
  storage: StorageAdapter;
  initialEmissionTimeoutMs?: number;
}): IdentityRepository {
  const cachedRequester = createCachedIdentityRequester(storage, getCacheKey);

  // Per-account de-dup: concurrent watchIdentity(acc) calls share one chain
  // subscription via the shared stream built below. The entry clears itself —
  // see the `finalize` in `buildWatch` — so the map can't accumulate dead
  // streams across distinct accounts.
  const watchCache = new Map<string, Observable<Identity | null>>();

  function buildWatch(accountId: string): Observable<Identity | null> {
    const live$ = adapter.watchIdentity(accountId).pipe(
      distinctUntilChanged(identitiesEqual),
      tap(identity => {
        if (identity === null) return;
        // Best-effort write-through; failures must not surface on the read.
        void storage.write(getCacheKey(accountId), JSON.stringify(identity));
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    // Seed from cache so warm consumers paint a value before the first chain
    // block. Only a non-null seed is emitted: a cold cache must fall through to
    // the live read / fallback rather than surface a premature `null` (that
    // also keeps the fallback timer below reachable). `shareReplay` keeps the
    // single storage read from being duplicated by the fallback's `takeUntil`.
    const seed$ = readCachedIdentity(storage, accountId).pipe(
      filter((identity): identity is Identity => identity !== null),
      takeUntil(live$),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    // Cold-cache + silent-chain safety net: emit `null` so the UI doesn't hang.
    const fallback$ = timer(initialEmissionTimeoutMs).pipe(
      takeUntil(merge(seed$, live$)),
      map(() => null as Identity | null),
    );

    const stream: Observable<Identity | null> = merge(seed$, live$, fallback$).pipe(
      distinctUntilChanged(identitiesEqual),
      // refCount tears down the chain subscription when the last subscriber
      // leaves; `finalize` then drops the map entry so a later watch rebuilds
      // a fresh stream instead of reusing a dead one. The shared `shareReplay`
      // guarantees this fires once, on the final unsubscribe — not per caller.
      // Guard on identity: a late re-subscribe to an already torn-down stream
      // must not evict a newer entry that another caller built for this account.
      finalize(() => {
        if (watchCache.get(accountId) === stream) watchCache.delete(accountId);
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    return stream;
  }

  return {
    getIdentity(accountId) {
      return cachedRequester([accountId], adapter.readIdentities).map(map => map[accountId] ?? null);
    },
    getIdentities(accounts) {
      return cachedRequester(accounts, adapter.readIdentities);
    },
    // Adapter errors propagate as-is; callers must attach an error handler
    // and re-subscribe to recover (no automatic retry).
    watchIdentity(accountId): Observable<Identity | null> {
      const existing = watchCache.get(accountId);
      if (existing) return existing;
      const stream = buildWatch(accountId);
      watchCache.set(accountId, stream);
      return stream;
    },
  };
}

function createCachedIdentityRequester(storage: StorageAdapter, getKey: (accountId: string) => string) {
  function readSingleCacheRecord(accountId: string) {
    return storage.read(getKey(accountId)).andThen<Result<Identity | null, Error>>(raw => {
      if (!raw) {
        return ok(null);
      }

      try {
        return ok(JSON.parse(raw));
      } catch (e) {
        return err(toError(e));
      }
    });
  }

  function writeSingleCacheRecord(accountId: string, identity: Identity | null) {
    if (identity === null) {
      return okAsync<void>(undefined);
    }
    return storage.write(getKey(accountId), JSON.stringify(identity));
  }

  function readCache(accounts: string[]) {
    if (accounts.length === 0) {
      return okAsync<Record<string, Identity | null>>({});
    }

    const identities = ResultAsync.combine(accounts.map(readSingleCacheRecord));
    return identities.map(identities => {
      return Object.fromEntries(
        identities.map((x, i) => {
          const accountId = accounts.at(i);
          if (!accountId) {
            throw new Error(`Identity not found`);
          }

          return [accountId, x];
        }),
      );
    });
  }

  function writeCache(identities: Record<string, Identity | null>) {
    return ResultAsync.combine(Object.entries(identities).map(args => writeSingleCacheRecord(...args))).map(
      () => identities,
    );
  }

  return (
    accounts: string[],
    request: (accounts: string[]) => ResultAsync<Record<string, Identity | null>, Error>,
  ): ResultAsync<Record<string, Identity | null>, Error> => {
    return readCache(accounts).andThen(existing => {
      const emptyIdentities = Object.entries(existing)
        .filter(([, identity]) => identity === null)
        .map(([accountId]) => accountId);

      if (emptyIdentities.length === 0) {
        return okAsync(existing);
      }

      return request(emptyIdentities)
        .andThen(writeCache)
        .map(fetched => ({
          ...existing,
          ...fetched,
        }));
    });
  };
}
