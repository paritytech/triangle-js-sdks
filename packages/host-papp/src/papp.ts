import type { LazyClient, StatementStoreAdapter } from '@novasamatech/statement-store';
import { createLazyClient, createPapiStatementStoreAdapter } from '@novasamatech/statement-store';
import type { StorageAdapter } from '@novasamatech/storage-adapter';
import { createLocalStorageAdapter } from '@novasamatech/storage-adapter';
import { getWsProvider } from '@polkadot-api/ws-provider';

import { SS_STABLE_STAGE_ENDPOINTS } from './constants.js';
import { createIdentityRepository } from './identity/impl.js';
import { createIdentityRpcAdapter } from './identity/rpcAdapter.js';
import type { IdentityAdapter, IdentityRepository } from './identity/types.js';
import type { AuthComponent, HostMetadata } from './sso/auth/impl.js';
import { createAuth } from './sso/auth/impl.js';
import type { SsoSessionManager } from './sso/sessionManager/impl.js';
import { createSsoSessionManager } from './sso/sessionManager/impl.js';
import { createUserSecretRepository } from './sso/userSecretRepository.js';
import { createUserSessionRepository } from './sso/userSessionRepository.js';

export type PappAdapter = {
  sso: AuthComponent;
  sessions: SsoSessionManager;
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
   * URL for additional metadata that will be displayed during pairing process.
   * Content of provided json shound be
   * ```ts
   * interface Metadata {
   *   name: string;
   *   icon: string; // url for icon. Icon should be a rasterized image with min size 256x256 px.
   * }
   * ```
   */
  metadata: string;
  /**
   * Optional host environment metadata for Sign-In confirmation screen.
   * All fields are optional - absence must not break the pairing flow.
   */
  hostMetadata?: HostMetadata;
  adapters?: Partial<Adapters>;
};

export function createPappAdapter({ appId, metadata, hostMetadata, adapters }: Params): PappAdapter {
  const lazyClient = adapters?.lazyClient ?? createLazyClient(getWsProvider(SS_STABLE_STAGE_ENDPOINTS));

  const statementStore = adapters?.statementStore ?? createPapiStatementStoreAdapter(lazyClient);
  const identities = adapters?.identities ?? createIdentityRpcAdapter(lazyClient);
  const storage = adapters?.storage ?? createLocalStorageAdapter(appId);

  const ssoSessionRepository = createUserSessionRepository(storage);
  const userSecretRepository = createUserSecretRepository(appId, storage);

  return {
    sso: createAuth({
      metadata,
      hostMetadata,
      statementStore,
      ssoSessionRepository,
      userSecretRepository,
      lazyClient,
    }),
    sessions: createSsoSessionManager({ storage, statementStore, ssoSessionRepository, userSecretRepository }),
    identity: createIdentityRepository({ adapter: identities, storage }),
  };
}
