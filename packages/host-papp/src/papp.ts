import type { LazyClient, StatementStoreAdapter } from '@novasamatech/statement-store';
import { createLazyClient, createPapiStatementStoreAdapter } from '@novasamatech/statement-store';
import type { StorageAdapter } from '@novasamatech/storage-adapter';
import { createLocalStorageAdapter } from '@novasamatech/storage-adapter';
import { getWsProvider } from 'polkadot-api/ws';

import { SS_STABLE_STAGE_ENDPOINTS } from './constants.js';
import { createIdentityRepository } from './identity/impl.js';
import { createIdentityRpcAdapter } from './identity/rpcAdapter.js';
import type { IdentityAdapter, IdentityRepository } from './identity/types.js';
import type { AllowanceService } from './sso/allowance/index.js';
import { createAllowanceRepository, createAllowanceService } from './sso/allowance/index.js';
import type { AuthComponent, HostMetadata, OnAuthSuccess } from './sso/auth/impl.js';
import { createAuth } from './sso/auth/impl.js';
import type { DeviceIdentityForPairing } from './sso/auth/v2/service.js';
import { createDeviceIdentityStore } from './sso/deviceIdentityStore.js';
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
  allowance: AllowanceService;
};

type Adapters = {
  statementStore: StatementStoreAdapter;
  identities: IdentityAdapter;
  storage: StorageAdapter;
  lazyClient: LazyClient;
};

type Params = {
  /**
   * Host app Id. CAUTION! This value should be stable across launches — it
   * seeds the storage prefix that backs every persisted SSO blob.
   */
  appId: string;
  /**
   * Host environment metadata embedded inside the V2 pairing proposal QR so
   * the paired device can render a request screen with the host name / icon /
   * platform. All fields are optional — absence must not break pairing.
   */
  hostMetadata?: HostMetadata;
  /**
   * Optional override for the device identity. Default: the SDK persists a
   * fresh identity to the configured `StorageAdapter` on first run and reuses
   * it on subsequent launches. Pass a factory only if you need a different
   * persistence backend (Electron Keychain, native secure storage, etc.).
   */
  deviceIdentity?: () => Promise<DeviceIdentityForPairing> | DeviceIdentityForPairing;
  /**
   * Optional caller hook fired after a successful handshake — after the SDK
   * has already written the session + secrets to its own repositories. Use it
   * for consumer-specific bookkeeping (telemetry, custom peer caches, device-
   * sync seeding). Throwing fails the `sso.authenticate()` call.
   */
  onAuthSuccess?: OnAuthSuccess;
  adapters?: Partial<Adapters>;
};

export function createPappAdapter({
  appId,
  hostMetadata,
  deviceIdentity,
  onAuthSuccess,
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
  const allowanceRepository = createAllowanceRepository(appId, storage);
  const deviceIdentityStore = createDeviceIdentityStore(appId, storage);

  const sessions = createSsoSessionManager({
    storage,
    statementStore,
    ssoSessionRepository,
    userSecretRepository,
    allowanceRepository,
  });

  return {
    sso: createAuth({
      hostMetadata,
      deviceIdentity,
      deviceIdentityStore,
      statementStore,
      ssoSessionRepository,
      userSecretRepository,
      onAuthSuccess,
    }),
    sessions,
    secrets: userSecretRepository,
    identity: createIdentityRepository({ adapter: identities, storage }),
    allowance: createAllowanceService({ sessions: sessions.sessions, repository: allowanceRepository }),
  };
}
