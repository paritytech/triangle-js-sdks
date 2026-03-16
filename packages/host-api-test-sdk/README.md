# @novasamatech/host-api-test-sdk

Lightweight test host for E2E testing embedded Polkadot dapps that use the Spektr host-container protocol (`@novasamatech/host-container`).

## Why

Products built with `@novasamatech/product-sdk` run inside an iframe and communicate with the host via `postMessage`. The SDK injects `window.injectedWeb3.spektr` only when it detects a real parent frame running `@novasamatech/host-container`.

To E2E test a product today you'd need the full triangle-web-host running — Next.js, React, wallet UI, DotNS, Service Workers. That's heavy and unnecessary for product tests.

This package gives you a **thin host page** that:

- Embeds your product in an iframe with the real Spektr protocol
- Injects dev accounts (Alice, Bob, ...) with known keypairs
- Auto-signs all extrinsic and raw signing requests — no popups
- Proxies chain RPC via WebSocket
- Exposes a control API for Playwright assertions (signing log, account switching)

No Docker, no React, no wallet UI. Just `npm install -E` and write tests.

## Install

```bash
npm install -E @novasamatech/host-api-test-sdk
```

## Usage with Playwright

```ts
// e2e/setup.ts
import { test as base, expect } from "@playwright/test";
import {
  createTestHostFixture,
  PASEO_ASSET_HUB,
} from "@novasamatech/host-api-test-sdk/playwright";

const { testHost } = createTestHostFixture({
  productUrl: "http://localhost:3000",
  accounts: ["alice"],
  chain: PASEO_ASSET_HUB,
});

export const test = base.extend({ testHost });
export { expect };
```

```ts
// e2e/transfer.spec.ts
import { test, expect } from "./setup";

test("transfer flow", async ({ testHost }) => {
  const frame = testHost.productFrame();

  // Product receives Alice's account via Spektr protocol
  await expect(frame.getByText("Alice")).toBeVisible();

  // Interact with the product UI
  await frame.getByRole("button", { name: "Transfer" }).click();

  // Signing happens automatically — verify it was requested
  const log = await testHost.getSigningLog();
  expect(log).toHaveLength(1);
  expect(log[0].type).toBe("payload");
});

test("multi-account", async ({ testHost }) => {
  await testHost.switchAccount("bob");
  const frame = testHost.productFrame();
  await expect(frame.getByText("Bob")).toBeVisible();
});
```

## Usage without Playwright

The core server works with any test framework or manual browser testing:

```ts
import { createTestHostServer } from "@novasamatech/host-api-test-sdk";

const server = await createTestHostServer({
  productUrl: "http://localhost:3000",
  accounts: ["alice", "bob"],
});

console.log("Open in browser:", server.url);
// → http://127.0.0.1:43210

// Cleanup when done
await server.close();
```

## Custom chain config

For public testnets, use the built-in chain configs:

```ts
import { PASEO_ASSET_HUB, PREVIEWNET } from "@novasamatech/host-api-test-sdk";

const server = await createTestHostServer({
  productUrl: "http://localhost:3000",
  chain: PASEO_ASSET_HUB,
});
```

For custom chains, pass a `ChainConfig` directly:

```ts
import { createTestHostServer } from "@novasamatech/host-api-test-sdk";

const server = await createTestHostServer({
  productUrl: "http://localhost:3000",
  chain: {
    id: "local-asset-hub",
    name: "Local Asset Hub",
    genesisHash: "0x...", // your chain's genesis hash
    rpcUrl: "ws://127.0.0.1:9944",
    tokenSymbol: "WND",
    tokenDecimals: 12,
  },
});
```

## How it works

```
Playwright test
  → createTestHostServer() starts a Node HTTP server
  → serves a single HTML page with an inlined browser bundle
  → the page creates an <iframe src="productUrl">
  → host-container establishes Spektr postMessage channel
  → registers handlers: accounts, signing, chain RPC, localStorage

Product (in iframe)
  → product-sdk detects iframe parent
  → injects window.injectedWeb3.spektr
  → gets accounts (Alice/Bob with real sr25519 public keys)
  → signing requests → host auto-signs with dev keypair → returns signature
```

The browser bundle (~780KB minified) includes `@novasamatech/host-container`, `@polkadot/keyring`, `@polkadot/types`, and WASM crypto. It's pre-built and inlined — consumers have zero build-time dependencies.

## Fixture API

| Method | Description |
|--------|-------------|
| `testHost.productFrame()` | Playwright `FrameLocator` for the product iframe |
| `testHost.switchAccount(name)` | Recreate container with a single account (iframe reloads) |
| `testHost.setAccounts(names)` | Recreate container with multiple accounts |
| `testHost.getSigningLog()` | All auto-signed payloads since last clear |
| `testHost.clearSigningLog()` | Reset the signing log |
| `testHost.waitForConnection(timeout?)` | Wait for product-sdk to connect |

## Dev accounts

| Name | URI | SS58 (generic) |
|------|-----|-----------------|
| `alice` | `//Alice` | `5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY` |
| `bob` | `//Bob` | `5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty` |
| `charlie` | `//Charlie` | `5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y` |
| `dave` | `//Dave` | `5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy` |
| `eve` | `//Eve` | `5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw` |
| `ferdie` | `//Ferdie` | `5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSneWj6JDfPN` |

These are standard Substrate dev accounts (sr25519, ss58Format=42). Products may re-encode them to a different SS58 prefix — the host matches by public key.

## Built-in chains

| Chain | ID |
|-------|----|
| Paseo Asset Hub | `PASEO_ASSET_HUB` |
| Previewnet | `PREVIEWNET` |
| Previewnet Asset Hub | `PREVIEWNET_ASSET_HUB` |

## Account switching

Product-sdk's `accounts.subscribe()` is one-shot. Changing accounts requires disposing the container and recreating it, which reloads the iframe. This matches how production hosts work. For multi-actor tests, prefer `setAccounts(['alice', 'bob'])` upfront and use the product's own account selector.

## License

Apache-2.0
