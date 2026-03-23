# @novasamatech/chain-connection

Reference-counted connection pool for `polkadot-api`. Connections are created on first use, shared across callers, and destroyed when the last caller releases them.

## Install

```bash
npm install @novasamatech/chain-connection
```

## Example: polkadot-desktop chain registry

This is the actual chain registry from [polkadot-desktop](https://github.com/paritytech/polkadot-desktop) — multiple Substrate chains, light client support, persistent metadata cache, and a `resolve` step that pre-builds typed APIs and codecs.

### registry.ts

```ts
import { createChainConnection, createMetadataCache, createWsJsonRpcProvider } from '@novasamatech/chain-connection';
import { createLocalStorageAdapter } from '@novasamatech/storage-adapter';
import { type JsonRpcProvider } from '@polkadot-api/json-rpc-provider';
import { getTypedCodecs } from 'polkadot-api';
import { getSmProvider } from 'polkadot-api/sm-provider';
import { type Client as SmoldotClient, start as startSmoldot } from 'polkadot-api/smoldot';
import { type Chain } from '../chain/types';
import { chainsSupportedLightClient, descriptors } from './constants';
import { getDescriptor } from './descriptors';
import { type TypedClient } from './types';

const metadataCache = createMetadataCache({
  storage: createLocalStorageAdapter('chain-metadata'),
});

let smoldot: SmoldotClient | null = null;

const createLightClientProvider = (chain: Chain): JsonRpcProvider => {
  let chainSpec;
  switch (chain.chainId) {
    case WellKnownChains.polkadotRelay:
      chainSpec = import('polkadot-api/chains/polkadot');
      break;
    case WellKnownChains.kusamaRelay:
      chainSpec = import('polkadot-api/chains/ksmcc3');
      break;
    case WellKnownChains.westendRelay:
      chainSpec = import('polkadot-api/chains/westend2');
      break;
    case WellKnownChains.rococoRelay:
      chainSpec = import('polkadot-api/chains/rococo_v2_2');
      break;
    default:
      throw new Error(`Light client for chain ${chain.name} is not supported.`);
  }

  const smoldotChain = chainSpec.then(({ chainSpec }) => {
    if (!smoldot) {
      smoldot = startSmoldot();
    }
    return smoldot.addChain({ chainSpec });
  });

  return getSmProvider(smoldotChain);
};

const chains = createChainConnection<Chain, TypedClient>({
  createProvider: (chain, onStatusChanged) => {
    if (chainsSupportedLightClient.includes(chain.chainId) && chain.chainId in WellKnownChains) {
      onStatusChanged('connected');

      return createLightClientProvider(chain);
    }

    return createWsJsonRpcProvider({
      endpoints: chain.nodes.map(n => n.url),
      onStatusChanged,
    });
  },
  clientOptions: chain => metadataCache.forChain(chain.chainId),
  resolve: async (chain, client) => {
    const { type, def } = getDescriptor(chain);
    const api = client.getTypedApi(def);
    const compatabilityToken = await api.compatibilityToken;
    const codecs = await getTypedCodecs(def);

    return { type, api, codecs, client, compatabilityToken };
  },
});

// chains: ChainConnection<Chain, TypedClient>
// ├── chains.requestApi(chain, callback)  — one-shot query, auto-releases connection
// ├── chains.lockApi(chain)               — long-lived lock, returns { api: TypedClient, unlock }
// ├── chains.getProvider(chain)           — raw JsonRpcProvider for iframe/container use
// ├── chains.status(chainId)              — current ConnectionStatus
// └── chains.onStatusChanged(chainId, cb) — subscribe to status changes

const polkadot: Chain = {
  chainId: '0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3',
  specName: 'polkadot',
  name: 'Polkadot',
  nodes: [{ url: 'wss://rpc.polkadot.io', name: 'Parity' }],
  // ...
};

// One-shot query — connection is acquired and released automatically
const account = await chains.requestApi(polkadot, async ({ api }) => {
  return api.query.System.Account.getValue('5GrwvaEF...');
});

// Long-lived lock — call unlock() when done (e.g. on component unmount)
const { api, unlock } = await chains.lockApi(polkadot);
const { api: typedApi } = api;
const sub = typedApi.query.System.Account.watchValue('5GrwvaEF...').subscribe({
  next: account => console.info('Balance:', account.data.free),
});
// cleanup
sub.unsubscribe();
unlock();

// Raw provider for iframe / product container
const provider = chains.getProvider(polkadot);

// Connection status
const status = chains.status(polkadot.chainId); // 'connecting' | 'connected' | 'disconnected'
const unsubscribe = chains.onStatusChanged(polkadot.chainId, status => {
  console.info('polkadot:', status);
});
```

## API

### `createChainConnection(config)`

Creates a connection pool. Generic over your chain config type `C` and resolved API type `T`.

```ts
type ChainConnectionConfig<C extends ChainConfig, T = PolkadotClient> = {
  createProvider: (chain: C, onStatusChanged: (status: ConnectionStatus) => void) => JsonRpcProvider;
  clientOptions?: (chain: C) => Parameters<typeof createClient>[1];
  resolve?: (chain: C, client: PolkadotClient) => Promise<T>;
};
```

`ChainConfig` — minimum shape your chain objects must satisfy:

```ts
type ChainConfig = {
  chainId: string;
  nodes: ReadonlyArray<{ url: string }>;
};
```

Returns a `ChainConnection<C, T>` with the methods below.

---

### `requestApi(chain, callback)`

Acquires a connection, runs the callback, and releases the connection when it settles. Best for one-shot queries.

```ts
const account = await chains.requestApi(polkadot, async ({ api }) => {
  return api.query.System.Account.getValue('5GrwvaEF...');
});
```

---

### `lockApi(chain)`

Acquires a connection and returns it with an `unlock` function. The connection stays alive until `unlock()` is called. Use for subscriptions or multi-step flows.

```ts
const { api, unlock } = await chains.lockApi(polkadot);

try {
  // use api...
} finally {
  unlock();
}
```

---

### `getProvider(chain)`

Returns a `JsonRpcProvider` backed by the shared pooled connection. Useful for passing to an iframe container or any library expecting a raw JSON-RPC provider.

```ts
const provider = chains.getProvider(polkadot);
```

---

### `status(chainId)` / `onStatusChanged(chainId, callback)`

Read or subscribe to connection status (`'connecting' | 'connected' | 'disconnected'`).

```ts
const status = chains.status('polkadot');

const unsubscribe = chains.onStatusChanged('polkadot', status => {
  console.info('polkadot:', status);
});
```

## Metadata cache

`createMetadataCache` caches chain metadata in memory, with optional persistence via a storage adapter. Wire it into `clientOptions` so `polkadot-api` skips re-fetching metadata on reconnect.

```ts
import { createMetadataCache } from '@novasamatech/chain-connection';
import { createLocalStorageAdapter } from '@novasamatech/storage-adapter';

// In-memory only
const cache = createMetadataCache();

// With persistence
const cache = createMetadataCache({
  storage: createLocalStorageAdapter('chain-metadata'),
});

const chains = createChainConnection({
  createProvider: (chain, onStatusChanged) =>
    createWsJsonRpcProvider({ endpoints: chain.nodes.map(n => n.url), onStatusChanged }),
  clientOptions: chain => cache.forChain(chain.chainId),
});
```

## `createWsJsonRpcProvider`

WebSocket provider factory. Wraps `polkadot-api`'s `getWsProvider` with `polkadot-sdk-compat` and normalizes WebSocket events to `ConnectionStatus`.

```ts
import { createWsJsonRpcProvider } from '@novasamatech/chain-connection';

const provider = createWsJsonRpcProvider({
  endpoints: ['wss://rpc.polkadot.io'],
  onStatusChanged: status => console.info(status),
});
```

## How it works

Each chain gets one underlying `JsonRpcProvider`. A **branched provider** multiplexes consumers over that single connection — each `lockApi`, `requestApi`, or `getProvider` call creates a branch. A **ref counter** tracks active branches: the connection opens when the first caller arrives and closes when the last one releases. When `resolve` is provided, the resolved API is cached and deduplicated per chain.
