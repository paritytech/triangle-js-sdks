import type { ResultAsync } from 'neverthrow';
import type { Observable } from 'rxjs';

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
  // Errors the stream when the underlying storage/pallet is unavailable.
  watchIdentity(accountId: string): Observable<Identity | null>;
};

export type IdentityRepository = {
  getIdentity(accountId: string): ResultAsync<Identity | null, Error>;
  getIdentities(accounts: string[]): ResultAsync<Record<string, Identity | null>, Error>;
  // Emits cached seed (if any), then distinct chain values; falls back to
  // `null` after WATCH_IDENTITY_INITIAL_TIMEOUT_MS if the source is silent.
  // Each distinct non-null value is written through to storage.
  watchIdentity(accountId: string): Observable<Identity | null>;
};
