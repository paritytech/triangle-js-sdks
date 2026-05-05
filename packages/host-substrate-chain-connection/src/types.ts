import type { JsonRpcProvider, PolkadotClient } from 'polkadot-api';

export type ChainConfig = {
  genesisHash: string;
};

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type BranchedProvider = {
  branch(onHalt?: VoidFunction): JsonRpcProvider;
};

export type PooledClient = {
  client: PolkadotClient;
  provider: BranchedProvider;
  rootProvider: JsonRpcProvider;
};
