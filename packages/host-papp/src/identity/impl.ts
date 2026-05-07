import type { StorageAdapter } from '@novasamatech/storage-adapter';
import { Result, ResultAsync, err, ok, okAsync } from 'neverthrow';

import { toError } from '../helpers/utils.js';

import type { Identity, IdentityAdapter, IdentityRepository } from './types.js';

export function createIdentityRepository({
  adapter,
  storage,
}: {
  adapter: IdentityAdapter;
  storage: StorageAdapter;
}): IdentityRepository {
  const cachedRequester = createCachedIdentityRequester(storage, accountId => `identity_${accountId}`);

  return {
    getIdentity(accountId) {
      return cachedRequester([accountId], adapter.readIdentities).map(map => map[accountId] ?? null);
    },
    getIdentities(accounts) {
      return cachedRequester(accounts, adapter.readIdentities);
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
