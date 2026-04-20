import type { JsonRpcProvider, PolkadotClient } from 'polkadot-api';

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
  rawProvider: JsonRpcProvider;
};
