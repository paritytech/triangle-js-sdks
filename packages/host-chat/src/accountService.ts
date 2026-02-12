import type { HexString } from '@novasamatech/scale';
import { toHex } from '@novasamatech/scale';
import type { LazyClient } from '@novasamatech/statement-store';
import { AccountId } from '@polkadot-api/substrate-bindings';
import type { ResultAsync } from 'neverthrow';
import { errAsync, fromPromise } from 'neverthrow';

import type { People_lite } from '../.papi/descriptors/dist/index.js';

import { toError } from './helpers.js';

interface NetworkConfig {
  id: Network;
  name: string;
  wsUrl: string;
  apiUrl: string;
}

type AccountStatus = 'ASSIGNED' | 'PENDING';

type AccountService = {
  search(query: string, status: AccountStatus): ResultAsync<SearchResponse, Error>;
  getConsumerInfo(address: string): ResultAsync<Identity | null, Error>;
};

type Network = 'stable' | 'unstable';

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

export const createAccountService = (network: Network, lazyClient: LazyClient): AccountService => {
  const networkConfig = NETWORK_CONFIGS[network];

  return {
    search(query, status) {
      // Build query string
      const params = new URLSearchParams({
        prefix: query,
        status,
      });

      const request = fromPromise(
        fetch(`${networkConfig.apiUrl}/usernames?${params}`, {
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
      const accountId = AccountId();
      const client = lazyClient.getClient();
      const api = client.getUnsafeApi<People_lite>();

      const consumerInfo = fromPromise(api.query.Resources?.Consumers?.getValue(address), toError);

      return consumerInfo.map<Identity | null>(raw => {
        if (!raw) return null;

        const credibility: Credibility =
          raw.credibility.type == 'Lite'
            ? {
                type: 'Lite',
              }
            : {
                type: 'Person',
                alias: raw.credibility.value.alias.asHex(),
                lastUpdate: raw.credibility.value.last_update.toString(),
              };

        return {
          accountId: toHex(accountId.enc(address)),
          fullUsername: raw.full_username ? raw.full_username.asText() : null,
          liteUsername: raw.lite_username.asText(),
          credibility: credibility,
        };
      });
    },
  };
};

const NETWORK_CONFIGS: Record<Network, NetworkConfig> = {
  stable: {
    id: 'stable',
    name: 'PoP Stable',
    wsUrl: 'wss://pop3-testnet.parity-lab.parity.io:443/7911',
    apiUrl: 'https://polkadot-app.api.polkadotcommunity.foundation/api/v1',
  },
  unstable: {
    id: 'unstable',
    name: 'PoP Unstable',
    wsUrl: 'wss://pop-testnet.parity-lab.parity.io:443/9910',
    apiUrl: 'https://polkadot-app-stg.parity.io/api/v1',
  },
};
