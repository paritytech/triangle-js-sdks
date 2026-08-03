import type { Identity } from '@novasamatech/host-papp';
import { createIdentityRpcAdapter } from '@novasamatech/host-papp';
import type { HexString } from '@novasamatech/scale';
import { toHex } from '@novasamatech/scale';
import type { LazyClient } from '@novasamatech/statement-store';
import type { ResultAsync } from 'neverthrow';
import { Result, errAsync, fromPromise } from 'neverthrow';
import { AccountId } from 'polkadot-api';

import { toError } from './helpers.js';

// `Resources.Consumers` is read through host-papp's identity provider — one decoder for
// the storage entry, one set of papi descriptors. The types are re-exported so this
// package's public surface doesn't force callers to import host-papp for them.
export type { Credibility, Identity } from '@novasamatech/host-papp';

interface Config {
  identityEndpoint: string;
  client: LazyClient;
}

type AccountStatus = 'ASSIGNED' | 'PENDING';

type AccountService = {
  search(query: string, status: AccountStatus): ResultAsync<SearchResponse, Error>;
  getConsumerInfo(address: string): ResultAsync<Identity | null, Error>;
};

type SearchResponse = {
  candidateAccountId: string;
  username: string;
  status: AccountStatus;
  onchainData: {
    blockIndex: number;
    blockNumber: number;
    blockHash: HexString;
    eventIndex: number;
  };
  createdAt: string;
  updatedAt: string;
}[];

export const createAccountService = (config: Config): AccountService => {
  const identityEndpoint = config.identityEndpoint.endsWith('/')
    ? config.identityEndpoint
    : `${config.identityEndpoint}/`;

  const accountIdCodec = AccountId();
  const identities = createIdentityRpcAdapter(config.client);

  // `enc` throws on a malformed SS58 address. `getConsumerInfo` returns a `ResultAsync`,
  // so that has to stay inside the Result instead of escaping as a synchronous throw.
  const encodeAccountId = Result.fromThrowable((address: string) => toHex(accountIdCodec.enc(address)), toError);

  return {
    search(query, status) {
      // Build query string
      const params = new URLSearchParams({
        prefix: query,
        status,
      });

      const request = fromPromise(
        fetch(`${identityEndpoint}usernames?${params}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        }),
        toError,
      );

      return request.andThen(response => {
        if (!response.ok) {
          return fromPromise(response.text(), toError).andThen(message =>
            errAsync(new Error(`status: ${response.status}, ${message}`)),
          );
        }

        return fromPromise(response.json(), toError);
      });
    },
    getConsumerInfo(address) {
      // The provider keys identities by hex account id; callers pass SS58 here.
      return encodeAccountId(address).asyncAndThen(accountId =>
        identities.readIdentities([accountId]).map(byAccountId => byAccountId[accountId] ?? null),
      );
    },
  };
};
