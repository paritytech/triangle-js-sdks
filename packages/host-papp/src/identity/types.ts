import type { ResultAsync } from 'neverthrow';
import type { Observable } from 'rxjs';

export type Credibility =
  | {
      type: 'Lite';
    }
  | {
      type: 'Person';
      alias: `0x${string}`;
      /**
       * `null` when the chain record carries no readable timestamp. The descriptor types
       * it as always present, but `getUnsafeApi` decodes against live runtime metadata,
       * so the two can disagree — and a missing timestamp is not a fabricated `0`.
       */
      lastUpdate: string | null;
    };

export type Identity = {
  accountId: string;
  fullUsername: string | null;
  liteUsername: string;
  credibility: Credibility;
  /**
   * The account's chat encryption public key (32-byte X25519), unwrapped from the
   * RFC-0004 container the chain stores it in. `null` when the record names a keypair
   * type this SDK does not implement — the account is still usable for everything that
   * does not need to encrypt to it.
   *
   * Hex rather than `Uint8Array` because `Identity` is JSON round-tripped through the
   * storage cache in `impl.ts`; a `Uint8Array` would come back as `{"0":…}`.
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
