import type { ResultAsync } from 'neverthrow';

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

export type IdentityAdapter = {
  readIdentities(accounts: string[]): ResultAsync<Record<string, Identity | null>, Error>;
};

export type IdentityRepository = {
  getIdentity(accountId: string): ResultAsync<Identity | null, Error>;
  getIdentities(accounts: string[]): ResultAsync<Record<string, Identity | null>, Error>;
};
