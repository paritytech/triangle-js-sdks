import type { HexString } from '@novasamatech/host-api';

export type { HexString } from '@novasamatech/host-api';

export interface ChainConfig {
  id: string;
  name: string;
  genesisHash: HexString;
  rpcUrl: string;
  tokenSymbol: string;
  tokenDecimals: number;
}

export type DevAccountName = 'alice' | 'bob' | 'charlie' | 'dave' | 'eve' | 'ferdie';

export interface DevAccountInfo {
  name: string;
  uri: string;
}

export interface TestHostServer {
  /** URL of the test host page (e.g. http://localhost:43210) */
  url: string;
  /** Stop the server */
  close(): Promise<void>;
}

export interface CreateTestHostOptions {
  /** URL of the product to embed (e.g. http://localhost:3001) */
  productUrl: string;
  /** Dev accounts to provide (default: ['alice']) */
  accounts?: DevAccountName[];
  /** Chain config (default: PASEO_ASSET_HUB) */
  chain?: ChainConfig;
  /** Port to listen on (default: 0 = random available port) */
  port?: number;
}

export interface SigningLogEntry {
  type: 'payload' | 'raw';
  payload: unknown;
  timestamp: number;
}

/** Shape of window.__TEST_HOST__ — shared between browser bundle and Playwright fixture. */
export interface TestHostAPI {
  switchAccount(name: string): Promise<void>;
  setAccounts(names: string[]): Promise<void>;
  getSigningLog(): SigningLogEntry[];
  clearSigningLog(): void;
  getConnectionStatus(): string;
  getChainStatus(): string;
  dispose(): void;
}
