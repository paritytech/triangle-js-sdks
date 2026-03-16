import type { ChainConfig, HexString } from './types.js';

export const PASEO_ASSET_HUB: ChainConfig = {
  id: 'paseo-asset-hub',
  name: 'Paseo Asset Hub',
  genesisHash: '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2' as HexString,
  rpcUrl: 'wss://sys.ibp.network/asset-hub-paseo',
  tokenSymbol: 'PAS',
  tokenDecimals: 10,
};

export const PREVIEWNET: ChainConfig = {
  id: 'previewnet',
  name: 'Previewnet',
  genesisHash: '0xdd51f3c2397b3ed8d69cfaa820d14e3a46e48fc53f10099855ead47685d7d77b' as HexString,
  rpcUrl: 'wss://previewnet.substrate.dev/relay/alice',
  tokenSymbol: 'UNIT',
  tokenDecimals: 12,
};

export const PREVIEWNET_ASSET_HUB: ChainConfig = {
  id: 'previewnet-asset-hub',
  name: 'Previewnet Asset Hub',
  genesisHash: '0x7765f98d559faf44baff547e8876a47c64cd1161f239d7df5a9e26194617f775' as HexString,
  rpcUrl: 'wss://previewnet.substrate.dev/asset-hub',
  tokenSymbol: 'UNIT',
  tokenDecimals: 12,
};

export const DEFAULT_CHAIN = PASEO_ASSET_HUB;

export const SUPPORTED_CHAINS: ChainConfig[] = [PASEO_ASSET_HUB, PREVIEWNET, PREVIEWNET_ASSET_HUB];
