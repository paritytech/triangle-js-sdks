import type { HexString } from '@novasamatech/scale';
import { toHex } from '@novasamatech/scale';
import type { LazyClient } from '@novasamatech/statement-store';
import { AccountId } from '@polkadot-api/substrate-bindings';
import type { ResultAsync } from 'neverthrow';
import { errAsync, fromPromise } from 'neverthrow';

import type { People_lite } from '../.papi/descriptors/dist/index.js';

import { toError } from './helpers.js';

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

export type Credibility =
  | {
      type: 'Lite';
    }
  | {
      type: 'Person';
      alias: `0x${string}`;
      lastUpdate: string;
    };

export type Identity = {
  accountId: string;
  fullUsername: string | null;
  liteUsername: string;
  credibility: Credibility;
};

export const createAccountService = (config: Config): AccountService => {
  const identityEndpoint = config.identityEndpoint.endsWith('/')
    ? config.identityEndpoint
    : `${config.identityEndpoint}/`;

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
      const textDecoder = new TextDecoder();
      const accountId = AccountId();
      const client = config.client.getClient();
      const api = client.getUnsafeApi<People_lite>();

      const consumerInfo = fromPromise(api.query.Resources?.Consumers?.getValue(address), toError);

      return consumerInfo.map<Identity | null>(typedRaw => {
        if (!typedRaw) return null;

        // Runtime metadata may expose fields in snake_case (V1) or
        // camelCase (V2 multi-device). Read defensively.
        const raw = typedRaw as unknown as Record<string, unknown> & typeof typedRaw;
        const fullUsername =
          (raw.full_username as Uint8Array | undefined) ?? (raw.fullUsername as Uint8Array | undefined);
        const liteUsername =
          (raw.lite_username as Uint8Array | undefined) ?? (raw.liteUsername as Uint8Array | undefined);

        const credibility: Credibility =
          raw.credibility.type === 'Lite'
            ? {
                type: 'Lite',
              }
            : {
                type: 'Person',
                alias: raw.credibility.value.alias as HexString,
                lastUpdate: ((raw.credibility.value as Record<string, unknown>).last_update ??
                  (raw.credibility.value as Record<string, unknown>).lastUpdate)!.toString(),
              };

        return {
          accountId: toHex(accountId.enc(address)),
          fullUsername: fullUsername ? textDecoder.decode(fullUsername) : null,
          liteUsername: liteUsername ? textDecoder.decode(liteUsername) : '',
          credibility: credibility,
        };
      });
    },
  };
};
