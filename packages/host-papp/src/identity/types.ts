import type { ResultAsync } from 'neverthrow';
import type { Observable } from 'rxjs';

export type Credibility =
  | {
      type: 'Lite';
    }
  | {
      type: 'Person';
      alias: `0x${string}`;
      /** `null` when the chain record carries no readable timestamp. */
      lastUpdate: string | null;
    };

export type Identity = {
  accountId: string;
  fullUsername: string | null;
  liteUsername: string;
  credibility: Credibility;
  /**
   * The account's 32-byte X25519 chat encryption key, unwrapped from its RFC-0004
   * container. `null` for a keypair type this SDK does not implement.
   *
   * Hex, not `Uint8Array`: `Identity` is JSON round-tripped through the storage cache.
   */
  identifierKey: `0x${string}` | null;
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
