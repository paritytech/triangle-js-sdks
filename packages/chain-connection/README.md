# @novasamatech/chain-connection

Reference-counted `polkadot-api` client management. Connections are created on demand, shared across callers, and torn down when the last caller releases them.

## Install

```bash
npm install @novasamatech/chain-connection
```

## Quick start

```ts
import { createChainConnection, createMetadataCache } from '@novasamatech/chain-connection';

const cache = createMetadataCache();

const chains = createChainConnection<MyChain>({
  createProvider: (chain, onStatus) =>
    createWsJsonRpcProvider({ endpoints: chain.nodes.map(n => n.url), onStatus }),
  clientOptions: chain => cache.forChain(chain.chainId),
});

// One-shot query — connection auto-released:
const balance = await chains.use(polkadot, async client => {
  const api = client.getTypedApi(dot);
  return api.query.System.Account.getValue(address);
});
```

## `use` — one-shot requests

```ts
const balance = await chains.use(polkadot, async client => {
  return client.getTypedApi(dot).query.System.Account.getValue(address);
});
```

## `acquire` — long-lived connections

```ts
const { client, release } = await chains.acquire(polkadot);
try {
  client.getTypedApi(dot).query.System.Events.watchValue('best').subscribe(handleEvents);
} catch {
  release();
}
// call release() in cleanup
```

## `getProvider` — iframe / product container

```ts
const provider = chains.getProvider(polkadot);
const container = createContainer(provider);
```

## Status

```ts
const status = chains.status(polkadot.chainId);
const unsub = chains.onStatus(polkadot.chainId, s => console.log(s));
```

## Metadata cache

Standalone building block for caching chain metadata. Works in-memory by default, optionally persists to storage.

```ts
import { createMetadataCache } from '@novasamatech/chain-connection';
import { createLocalStorageAdapter } from '@novasamatech/storage-adapter';

// In-memory only:
const cache = createMetadataCache();

// Persistent (survives page refresh):
const cache = createMetadataCache({
  storage: createLocalStorageAdapter('chain-metadata'),
});

// With build-time metadata fallback:
const cache = createMetadataCache({
  storage: createLocalStorageAdapter('chain-metadata'),
  fallback: key => getMetadata(key), // from @polkadot-api/descriptors
});

// Wire into connection:
const chains = createChainConnection<MyChain>({
  createProvider: (chain, onStatus) => ...,
  clientOptions: chain => cache.forChain(chain.chainId),
});

// Cache management:
await cache.clear(chainId);  // clear one chain
await cache.clearAll();       // clear everything
```

## `createWsJsonRpcProvider`

WebSocket provider with `polkadot-sdk-compat` and normalised status events.

```ts
import { createWsJsonRpcProvider } from '@novasamatech/chain-connection';

const provider = createWsJsonRpcProvider({
  endpoints: ['wss://rpc.polkadot.io'],
  onStatus: status => console.log(status),
});
```

## How it works

Each chain gets one `JsonRpcProvider`. A branched provider multiplexes consumers over the single connection. A ref counter tracks active callers — when it drops to zero the connection closes; when the first caller arrives it opens. `getProvider` branches off the same shared connection so iframe consumers participate in the same ref count.
