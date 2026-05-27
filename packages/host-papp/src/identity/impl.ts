import type { StorageAdapter } from '@novasamatech/storage-adapter';
import { Result, ResultAsync, err, ok, okAsync } from 'neverthrow';
import type { Observable } from 'rxjs';
import { distinctUntilChanged, map, merge, share, takeUntil, tap, timer } from 'rxjs';

import { toError } from '../helpers/utils.js';

import type { Identity, IdentityAdapter, IdentityRepository } from './types.js';

/**
 * Hard ceiling for `watchIdentity`'s first emission. Without this, a cold or
 * unreachable WS would leave consumers spinning indefinitely. After the
 * timeout the stream emits `null`; a real chain emission still arrives later
 * and takes over, thanks to `distinctUntilChanged`.
 */
export const WATCH_IDENTITY_INITIAL_TIMEOUT_MS = 15_000;

function getCacheKey(accountId: string): string {
  return `identity_${accountId}`;
}

function identitiesEqual(a: Identity | null, b: Identity | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.fullUsername !== b.fullUsername) return false;
  if (a.liteUsername !== b.liteUsername) return false;
  if (a.credibility.type !== b.credibility.type) return false;
  if (a.credibility.type === 'Person' && b.credibility.type === 'Person') {
    if (a.credibility.alias !== b.credibility.alias) return false;
    if (a.credibility.lastUpdate !== b.credibility.lastUpdate) return false;
  }
  return true;
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

  return {
    getIdentity(accountId) {
      return cachedRequester([accountId], adapter.readIdentities).map(map => map[accountId] ?? null);
    },
    getIdentities(accounts) {
      return cachedRequester(accounts, adapter.readIdentities);
    },
    watchIdentity(accountId): Observable<Identity | null> {
      const source$ = adapter.watchIdentity(accountId).pipe(
        distinctUntilChanged(identitiesEqual),
        tap(identity => {
          // Write-through: every distinct chain value refreshes the storage
          // cache so non-watching readers see the same freshness.
          if (identity === null) return;
          // Best-effort. ResultAsync runs eagerly; a write failure must not
          // surface on the live read so we don't subscribe to the result.
          void storage.write(getCacheKey(accountId), JSON.stringify(identity));
        }),
        // `takeUntil(source$)` in the fallback below subscribes a second time;
        // without share() the tap would write twice per emission until the
        // fallback is cancelled.
        share(),
      );
      const fallback$ = timer(initialEmissionTimeoutMs).pipe(
        takeUntil(source$),
        map(() => null),
      );
      return merge(source$, fallback$);
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
