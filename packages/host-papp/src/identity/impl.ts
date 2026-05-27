import type { StorageAdapter } from '@novasamatech/storage-adapter';
import { Result, ResultAsync, err, ok, okAsync } from 'neverthrow';
import type { Observable } from 'rxjs';
import { catchError, defer, distinctUntilChanged, map, merge, of, shareReplay, takeUntil, tap, timer } from 'rxjs';

import { toError } from '../helpers/utils.js';

import type { Identity, IdentityAdapter, IdentityRepository } from './types.js';

/**
 * Hard ceiling for `watchIdentity`'s first emission when the cache is cold.
 * Without this, a cold or unreachable WS would leave consumers spinning
 * indefinitely. After the timeout the stream emits `null`; a real chain
 * emission still arrives later and takes over, thanks to
 * `distinctUntilChanged`. When the cache has a value it's emitted
 * immediately and the timer is cancelled before it fires.
 */
export const WATCH_IDENTITY_INITIAL_TIMEOUT_MS = 15_000;

function getCacheKey(accountId: string): string {
  return `identity_${accountId}`;
}

/**
 * Structural identity equality. Used by `distinctUntilChanged` so that adding
 * a field to `Identity` doesn't silently bypass deduping / write-through.
 * Identity values flow through `decodeRawIdentity` only, so key order is
 * deterministic and `JSON.stringify` is safe here.
 */
function identitiesEqual(a: Identity | null, b: Identity | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function readCachedIdentity(storage: StorageAdapter, accountId: string): Observable<Identity | null> {
  return defer(() =>
    storage
      .read(getCacheKey(accountId))
      .match<Identity | null>(
        raw => {
          if (!raw) return null;
          try {
            return JSON.parse(raw) as Identity;
          } catch {
            return null;
          }
        },
        () => null,
      )
      .then(value => value),
  ).pipe(catchError(() => of<Identity | null>(null)));
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

  // Per-account de-dup: N concurrent `watchIdentity(acc)` calls share one
  // chain subscription. `shareReplay` with `refCount` tears the upstream down
  // when all subscribers leave so we don't leak WS subscriptions.
  const watchCache = new Map<string, Observable<Identity | null>>();

  function buildWatch(accountId: string): Observable<Identity | null> {
    // Live chain reads, multicast so the seed/fallback `takeUntil` branches
    // don't open extra upstream subscriptions and the tap doesn't run twice.
    // `shareReplay({refCount: true})` tears the upstream down when the last
    // subscriber leaves and rebuilds it on the next subscription, so a stale
    // accountId entry in `watchCache` doesn't hold a chain subscription open.
    const live$ = adapter.watchIdentity(accountId).pipe(
      distinctUntilChanged(identitiesEqual),
      tap(identity => {
        // Write-through: every distinct chain value refreshes the storage
        // cache so non-watching readers see the same freshness.
        if (identity === null) return;
        // Best-effort. ResultAsync runs eagerly; a write failure must not
        // surface on the live read so we don't subscribe to the result.
        void storage.write(getCacheKey(accountId), JSON.stringify(identity));
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    // Seed: surface the cached value (if any) as the first emission so
    // consumers exit `pending` instantly on warm cache instead of waiting
    // for `watchValue` to deliver its first block. Stale-OK: any divergent
    // chain emission immediately overwrites via the outer
    // `distinctUntilChanged`. Dropped if `live$` beats it.
    const seed$ = readCachedIdentity(storage, accountId).pipe(takeUntil(live$));

    // Cold-cache + silent-chain safety net: if neither seed nor live$ have
    // delivered within the timeout, emit `null` so the UI doesn't hang on
    // `pending=true` forever.
    const fallback$ = timer(initialEmissionTimeoutMs).pipe(
      takeUntil(merge(seed$, live$)),
      map(() => null as Identity | null),
    );

    return merge(seed$, live$, fallback$).pipe(distinctUntilChanged(identitiesEqual));
  }

  return {
    getIdentity(accountId) {
      return cachedRequester([accountId], adapter.readIdentities).map(map => map[accountId] ?? null);
    },
    getIdentities(accounts) {
      return cachedRequester(accounts, adapter.readIdentities);
    },
    /**
     * Subscribers MUST attach an `error` handler. Adapter errors propagate
     * (no automatic retry); the consumer is responsible for re-subscribing
     * if recovery is desired.
     */
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
