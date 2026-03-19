# @novasamatech/chain-connection

Reference-counted `polkadot-api` client management. Connections are created on demand, shared across callers, and torn down when the last caller releases them.

## Install

```bash
npm install @novasamatech/chain-connection
```

## Full example

```ts
import { createChainConnection, createMetadataCache, createWsJsonRpcProvider } from '@novasamatech/chain-connection';
import { createLocalStorageAdapter } from '@novasamatech/storage-adapter';
import { dot } from 'polkadot-api';

// Metadata cache persists chain metadata across page reloads
const metadataCache = createMetadataCache({
  storage: createLocalStorageAdapter('chain-metadata'),
});

const chains = createChainConnection({
  createProvider: (chain, onStatusChanged) =>
    createWsJsonRpcProvider({
      endpoints: chain.nodes.map(n => n.url),
      onStatusChanged,
    }),
  clientOptions: chain => metadataCache.forChain(chain.chainId),
});

const polkadot = {
  chainId: 'polkadot',
  nodes: [{ url: 'wss://rpc.polkadot.io' }],
};

// One-shot query — connection locked for the callback, then released
const balance = await chains.requestApi(polkadot, async client => {
  const api = client.getTypedApi(dot);
  return api.query.System.Account.getValue(address);
});

// Long-lived connection — call unlock() when done
const { api: client, unlock } = await chains.lockApi(polkadot);
const typedApi = client.getTypedApi(dot);
const sub = typedApi.query.System.Events.watchValue('best').subscribe(handleEvents);

sub.unsubscribe();
unlock();

// Connection status
chains.onStatusChanged(polkadot.chainId, status => {
  console.info('polkadot:', status); // 'connecting' | 'connected' | 'disconnected'
});
```

## `requestApi` — one-shot requests

Connection is locked before the callback and unlocked when it resolves or throws.

```ts
const balance = await chains.requestApi(polkadot, async client => {
  return client.getTypedApi(dot).query.System.Account.getValue(address);
});
```

## `lockApi` — long-lived connections

For subscriptions and multi-step flows. Call `unlock()` when done.

```ts
const { api, unlock } = await chains.lockApi(polkadot);
try {
  const typedApi = api.getTypedApi(dot);
  typedApi.query.System.Events.watchValue('best').subscribe(handleEvents);
} catch {
  unlock();
}
// call unlock() in cleanup (e.g. component unmount)
```

## `getProvider` — iframe / product container

Returns a `JsonRpcProvider` backed by the shared connection.

```ts
const provider = chains.getProvider(polkadot);
const container = createContainer(provider);
```

## Status

```ts
const status = chains.status(polkadot.chainId); // 'connecting' | 'connected' | 'disconnected'

const unsub = chains.onStatusChanged(polkadot.chainId, status => {
  console.log('status changed:', status);
});
```

## `resolve` — typed API resolution

Pass a `resolve` callback to wrap the raw `PolkadotClient` in a typed API. The SDK caches and deduplicates resolution per chain.

```ts
const chains = createChainConnection<MyChain, TypedClient>({
  createProvider: (chain, onStatusChanged) =>
    createWsJsonRpcProvider({ endpoints: chain.nodes.map(n => n.url), onStatusChanged }),
  resolve: async (chain, client) => {
    const descriptor = getDescriptor(chain);
    const api = client.getTypedApi(descriptor);
    const codecs = await getTypedCodecs(descriptor);
    return { api, codecs, client };
  },
});

// requestApi/lockApi now return your resolved type:
await chains.requestApi(polkadot, async ({ api }) => {
  return api.query.System.Account.getValue(address);
});
```

## Metadata cache

Standalone building block for caching chain metadata. In-memory by default, optionally persists to storage.

```ts
import { createMetadataCache } from '@novasamatech/chain-connection';
import { createLocalStorageAdapter } from '@novasamatech/storage-adapter';

// In-memory only:
const cache = createMetadataCache();

// Persistent (survives page refresh):
const cache = createMetadataCache({
  storage: createLocalStorageAdapter('chain-metadata'),
});

// Wire into connection:
const chains = createChainConnection<MyChain>({
  createProvider: (chain, onStatusChanged) => ...,
  clientOptions: chain => cache.forChain(chain.chainId),
});

```

## `createWsJsonRpcProvider`

WebSocket provider with `polkadot-sdk-compat` and normalised status events.

```ts
import { createWsJsonRpcProvider } from '@novasamatech/chain-connection';

const provider = createWsJsonRpcProvider({
  endpoints: ['wss://rpc.polkadot.io'],
  onStatusChanged: status => console.log(status),
});
```

## How it works

Each chain gets one `JsonRpcProvider`. A branched provider multiplexes consumers over the single connection. A ref counter tracks active callers — when it drops to zero the connection closes; when the first caller arrives it opens. `getProvider` branches off the same shared connection so iframe consumers participate in the same ref count.
