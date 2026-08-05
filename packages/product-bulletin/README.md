# @novasamatech/product-bulletin

Bulletin Chain client adapter for Polkadot product applications.

## Overview

Wraps [`@parity/bulletin-sdk`](https://github.com/paritytech/polkadot-bulletin-chain/tree/main/sdk/typescript) for use
inside product applications. Creates a polkadot-api client via `createPapiProvider()` from
`@novasamatech/host-api-wrapper` and wires it to `AsyncBulletinClient`.

## Installation

```shell
npm install @novasamatech/product-bulletin --save -E
```

## Usage

```ts
import { createAccountsProvider } from '@novasamatech/host-api-wrapper';
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
  .withCallback(event => console.log(event))
  .send();

// Clean up when done
await client.destroy();
```

> **Error handling:** unlike `@novasamatech/host-api-wrapper`, `AsyncBulletinClient` methods **throw** on failure (they
> do not return `Result`). Catch `BulletinError` and inspect its `code` (see `ErrorCode`) to handle specific failure
> modes.

### Known networks

`BulletinChain` provides genesis hashes and PAPI descriptors for known networks:

| Network             | Key                        |
| ------------------- | -------------------------- |
| Westend Bulletin    | `BulletinChain.westend`    |
| Bulletin Paseo      | `BulletinChain.paseo`      |
| Paseo Bulletin Next | `BulletinChain.popStable`  |
| Bulletin Local      | `BulletinChain.previewnet` |

> **`popStable` no longer points at the PoP testnet.** That chain was retired; the key now resolves to Paseo Bulletin
> Next. The name was kept to avoid a rename on top of the genesis-hash change — see the
> [migration guide](../../docs/migration/v0.9.md#genesis-hashes).

> **`renew` is broken on every network except `westend`.** Current Bulletin runtimes take an entry selector where
> `@parity/bulletin-sdk` 0.3.0 still sends `{ block, index }`. `store` and the chunked upload path are unaffected — see
> the [migration guide](../../docs/migration/v0.9.md#known-issue-renew).

### Configuration

Optional `config` parameter forwarded to `AsyncBulletinClient`. All fields are optional; see `ClientConfig` from
`@parity/bulletin-sdk` for the full set and defaults.

```ts
const client = createBulletinClient({
  ...BulletinChain.paseo,
  signer,
  config: {
    defaultChunkSize: 1024 * 1024, // 1 MiB
    createManifest: true,
    chunkingThreshold: 2 * 1024 * 1024, // 2 MiB
    // txTimeout: 420_000,
  },
});
```

### Re-exports

In addition to `createBulletinClient` and `BulletinChain`, this package re-exports the public surface of
`@parity/bulletin-sdk` (`AsyncBulletinClient`, `BulletinError`, `ErrorCode`, `CID`, `CidCodec`, `WaitFor`,
`BulletinPreparer`, `calculateCid`, `parseCid`, `cidFromBytes`, `getContentHash`, and the relevant types) so consumers
don't need a direct dependency on it. Refer to the
[`@parity/bulletin-sdk` documentation](https://github.com/paritytech/polkadot-bulletin-chain/tree/main/sdk/typescript)
for details.
