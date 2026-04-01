import type { JsonRpcProvider } from '@polkadot-api/json-rpc-provider';
import type { PolkadotClient } from 'polkadot-api';

export type ChainConfig = {
  genesisHash: string;
};

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type BranchedProvider = {
  branch(onDisconnect?: VoidFunction): JsonRpcProvider;
};

export type PooledClient = {
  client: PolkadotClient;
  provider: BranchedProvider;
};
