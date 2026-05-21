import type { LazyClient, StatementStoreAdapter } from '@novasamatech/statement-store';
import { createLazyClient, createPapiStatementStoreAdapter } from '@novasamatech/statement-store';
import type { StorageAdapter } from '@novasamatech/storage-adapter';
import { createLocalStorageAdapter } from '@novasamatech/storage-adapter';
import { getWsProvider } from 'polkadot-api/ws';

import { SS_STABLE_STAGE_ENDPOINTS } from './constants.js';
import { createIdentityRepository } from './identity/impl.js';
import { createIdentityRpcAdapter } from './identity/rpcAdapter.js';
import type { IdentityAdapter, IdentityRepository } from './identity/types.js';
import type { AuthComponent, AuthSuccess, HostMetadata } from './sso/auth/impl.js';
import { createAuth } from './sso/auth/impl.js';
import type { DeviceIdentityForPairing } from './sso/auth/v2/service.js';
import type { SsoSessionManager } from './sso/sessionManager/impl.js';
import { createSsoSessionManager } from './sso/sessionManager/impl.js';
import type { UserSecretRepository } from './sso/userSecretRepository.js';
import { createUserSecretRepository } from './sso/userSecretRepository.js';
import { createUserSessionRepository } from './sso/userSessionRepository.js';

export type PappAdapter = {
  sso: AuthComponent;
  sessions: SsoSessionManager;
  secrets: UserSecretRepository;
  identity: IdentityRepository;
};

type Adapters = {
  statementStore: StatementStoreAdapter;
  identities: IdentityAdapter;
  storage: StorageAdapter;
  lazyClient: LazyClient;
};

type Params = {
  /**
   * Host app Id.
   * CAUTION! This value should be stable.
   */
  appId: string;
  /**
   * Host environment metadata embedded in the pairing proposal so PApp can
   * render the request screen. All fields are optional — absence must not
   * break the pairing flow.
   */
  hostMetadata?: HostMetadata;
  /**
   * Persistent V2 device identity. The same identity must be returned on every
   * launch so PApp recognises this device as the same peer. The factory is
   * invoked per `sso.authenticate()` call, so callers can lazy-load from
   * keychain / IndexedDB without blocking adapter construction.
   */
  deviceIdentity: () => Promise<DeviceIdentityForPairing> | DeviceIdentityForPairing;
  /**
   * Caller hook fired after a successful handshake, before
   * `sso.authenticate()` resolves. Throwing fails the call.
   */
  onAuthSuccess?: (success: AuthSuccess) => Promise<void>;
  /**
   * Reload-survival dedupe: hex of the last pairing-topic statement consumed
   * by this device. Resolved per `sso.authenticate()` so callers can read
   * from async storage (IndexedDB / keychain) without blocking adapter
   * construction.
   */
  initialProcessedDataHex?: () => Promise<string | null> | string | null;
  onPairingStatementProcessed?: (dataHex: string) => void;
  adapters?: Partial<Adapters>;
};

export function createPappAdapter({
  appId,
  hostMetadata,
  deviceIdentity,
  onAuthSuccess,
  initialProcessedDataHex,
  onPairingStatementProcessed,
  adapters,
}: Params): PappAdapter {
  const lazyClient =
    adapters?.lazyClient ??
    createLazyClient(getWsProvider(SS_STABLE_STAGE_ENDPOINTS, { heartbeatTimeout: Number.POSITIVE_INFINITY }));

  const statementStore = adapters?.statementStore ?? createPapiStatementStoreAdapter(lazyClient);
  const identities = adapters?.identities ?? createIdentityRpcAdapter(lazyClient);
  const storage = adapters?.storage ?? createLocalStorageAdapter(appId);

  const ssoSessionRepository = createUserSessionRepository(storage);
  const userSecretRepository = createUserSecretRepository(appId, storage);

  return {
    sso: createAuth({
      hostMetadata,
      deviceIdentity,
      statementStore,
      persistOnSuccess: onAuthSuccess,
      initialProcessedDataHex,
      onStatementProcessed: onPairingStatementProcessed,
    }),
    sessions: createSsoSessionManager({ storage, statementStore, ssoSessionRepository, userSecretRepository }),
    secrets: userSecretRepository,
    identity: createIdentityRepository({ adapter: identities, storage }),
  };
}
