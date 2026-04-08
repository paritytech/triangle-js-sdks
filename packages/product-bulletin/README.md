# @novasamatech/product-bulletin

Bulletin Chain client adapter for Polkadot product applications.

## Overview

Wraps [`@parity/bulletin-sdk`](https://github.com/paritytech/polkadot-bulletin-chain/tree/main/sdk/typescript) for use inside product applications. Creates a polkadot-api client via `createPapiProvider()` from `@novasamatech/product-sdk` and wires it to `AsyncBulletinClient`.

## Installation

```shell
npm install @novasamatech/product-bulletin --save -E
```

## Usage

```ts
import { createAccountsProvider } from '@novasamatech/product-sdk';
import { BulletinChain, createBulletinClient } from '@novasamatech/product-bulletin';

// Get signer from product account
const accounts = createAccountsProvider();
const account = await accounts.getProductAccount('my-product.dot');
const signer = accounts.getProductAccountSigner(account);

// Create client
const { client, destroy } = createBulletinClient({
  genesisHash: BulletinChain.paseo,
  signer,
});

// Store data
const result = await client.store(data).send();
console.log('Stored CID:', result.cid?.toString());

// Chunked upload with progress
const largeResult = await client
  .store(largeData)
  .withChunkSize(1024 * 1024)
  .withCallback((event) => console.log(event))
  .send();

// Clean up when done
destroy();
```

### Known networks

`BulletinChain` provides genesis hashes for known networks:

| Network | Key |
|---------|-----|
| Bulletin Westend | `BulletinChain.westend` |
| Bulletin Paseo | `BulletinChain.paseo` |
| PoP Testnet (stable) | `BulletinChain.popStable` |

### Configuration

Optional `config` parameter for chunk size and manifest behavior:

```ts
const { client, destroy } = createBulletinClient({
  genesisHash: BulletinChain.paseo,
  signer,
  config: {
    defaultChunkSize: 1024 * 1024,  // 1 MiB
    createManifest: true,
    chunkingThreshold: 2 * 1024 * 1024,  // 2 MiB
  },
});
```

### Lifecycle

`createBulletinClient` returns a `BulletinClientHandle` with:
- `client` — the `AsyncBulletinClient` instance from `@parity/bulletin-sdk`
- `destroy()` — disconnects the underlying `PolkadotClient` and releases resources

