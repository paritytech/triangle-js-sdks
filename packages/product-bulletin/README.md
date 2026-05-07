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

// Get a signer from a product account.
// `getProductAccount` returns a neverthrow `ResultAsync` — unwrap before passing to the signer.
const accounts = createAccountsProvider();
const accountResult = await accounts.getProductAccount('my-product.dot');
if (accountResult.isErr()) throw accountResult.error;
const signer = accounts.getProductAccountSigner(accountResult.value);

// Create client
const client = createBulletinClient({
  ...BulletinChain.paseo,
  signer,
});

const result = await client.store(data).send();
console.log('Stored CID:', result.cid?.toString());

// Chunked upload with progress
const largeResult = await client
  .store(largeData)
  .withChunkSize(1024 * 1024)
  .withCallback((event) => console.log(event))
  .send();

// Clean up when done
await client.destroy();
```

> **Error handling:** unlike `@novasamatech/product-sdk`, `AsyncBulletinClient` methods **throw** on failure (they do not return `Result`). Catch `BulletinError` and inspect its `code` (see `ErrorCode`) to handle specific failure modes.

### Known networks

`BulletinChain` provides genesis hashes and PAPI descriptors for known networks:

| Network              | Key                        |
|----------------------|----------------------------|
| Bulletin Westend     | `BulletinChain.westend`    |
| Bulletin Paseo       | `BulletinChain.paseo`      |
| PoP Testnet (stable) | `BulletinChain.popStable`  |
| Bulletin Previewnet  | `BulletinChain.previewnet` |

### Configuration

Optional `config` parameter forwarded to `AsyncBulletinClient`. All fields are optional; see `ClientConfig` from `@parity/bulletin-sdk` for the full set and defaults.

```ts
const client = createBulletinClient({
  ...BulletinChain.paseo,
  signer,
  config: {
    defaultChunkSize: 1024 * 1024,       // 1 MiB
    createManifest: true,
    chunkingThreshold: 2 * 1024 * 1024,  // 2 MiB
    // txTimeout: 420_000,
  },
});
```

### Re-exports

In addition to `createBulletinClient` and `BulletinChain`, this package re-exports the public surface of `@parity/bulletin-sdk` (`AsyncBulletinClient`, `BulletinError`, `ErrorCode`, `CID`, `CidCodec`, `WaitFor`, `BulletinPreparer`, `calculateCid`, `parseCid`, `cidFromBytes`, `getContentHash`, and the relevant types) so consumers don't need a direct dependency on it. Refer to the [`@parity/bulletin-sdk` documentation](https://github.com/paritytech/polkadot-bulletin-chain/tree/main/sdk/typescript) for details.
