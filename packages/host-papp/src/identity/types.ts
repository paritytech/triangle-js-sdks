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
  /**
   * Live subscription to a single account's on-chain identity. Each emission
   * is the freshest value the source observed; emits `null` when no entry
   * exists. Implementations should error the stream when the underlying
   * storage/pallet is unavailable.
   */
  watchIdentity(accountId: string): Observable<Identity | null>;
};

export type IdentityRepository = {
  getIdentity(accountId: string): ResultAsync<Identity | null, Error>;
  getIdentities(accounts: string[]): ResultAsync<Record<string, Identity | null>, Error>;
  /**
   * Live subscription to a single account's identity. Emits each distinct
   * value the chain reports, plus a final-fallback `null` if the source
   * doesn't emit within {@link WATCH_IDENTITY_INITIAL_TIMEOUT_MS}, so
   * consumers don't hang on a dead WS. Every distinct non-null emission is
   * written through to the storage cache so non-watching readers
   * (`getIdentity`/`getIdentities`) see the freshest value.
   */
  watchIdentity(accountId: string): Observable<Identity | null>;
};
