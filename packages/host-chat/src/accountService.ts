import type { Identity, IdentityRepository } from '@novasamatech/host-papp';
import type { HexString } from '@novasamatech/scale';
import { toHex } from '@novasamatech/scale';
import type { ResultAsync } from 'neverthrow';
import { Result, errAsync, fromPromise } from 'neverthrow';
import { AccountId } from 'polkadot-api';

import { toError } from './helpers.js';

export type { Credibility, Identity } from '@novasamatech/host-papp';

export type IdentitySource = Pick<IdentityRepository, 'getIdentity'>;

interface Config {
  identityEndpoint: string;
  /** Pass `papp.identity`, or build one with `createIdentityRepository({ adapter, storage })`. */
  identity: IdentitySource;
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

  // `enc` throws on a malformed SS58 address; keep that inside the Result.
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
      return encodeAccountId(address).asyncAndThen(accountId => config.identity.getIdentity(accountId));
    },
  };
};
