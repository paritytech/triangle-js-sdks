import type { JsonRpcProvider } from '@polkadot-api/json-rpc-provider';
import type { ChainDefinition, CompatibilityToken, PolkadotClient, TypedApi, getTypedCodecs } from 'polkadot-api';

export type ChainConfig = {
  chainId: string;
  nodes: ReadonlyArray<{ url: string }>;
};

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type BranchedProvider = {
  branch(onDisconnect?: VoidFunction): JsonRpcProvider;
};

export type PooledClient = {
  client: PolkadotClient;
  provider: BranchedProvider;
};

type TypedCodecs<D extends ChainDefinition> = Awaited<ReturnType<typeof getTypedCodecs<D>>>;

export type TypedClient<D extends ChainDefinition = ChainDefinition> = {
  client: PolkadotClient;
  api: TypedApi<D>;
  codecs: TypedCodecs<D>;
  compatibilityToken: CompatibilityToken;
  provider: BranchedProvider;
};
