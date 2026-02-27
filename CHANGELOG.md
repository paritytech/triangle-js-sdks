## 0.6.4 (2026-02-27)

### 🚀 Features

- OptionBool codec

### 🩹 Fixes

- Small custom renderer api changes ([ce7961c](https://github.com/Polkadot-Community-Foundation/triangle-js-sdks/commit/ce7961c))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.6.3 (2026-02-27)

### 🩹 Fixes

- Fix codec for custom renderer's Button and Text 
- Pass message id to chat custom renderer
- Remove Error throw inside PAPI adapter if chain is not supported.

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.6.1 (2026-02-20)

### 🩹 Fixes

- correct import of verifible js ([524b297](https://github.com/Polkadot-Community-Foundation/triangle-js-sdks/commit/524b297))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.6.0 (2026-02-20)

### 🚀 Features

Host API
- Implemented `host_account_connection_status_subscribe` method for receiving current sign in status of the host.
- Implemented `product_chat_custom_message_render_subscribe` method with initial implementation of custom renderer.

PAPP integration
- Added support of `sign raw` method
  ⚠️ BREAKING CHANGE

Product SDK
- Implemented new method for custom message renderer in chat `productChat.onCustomMessageRenderingRequest`
- Implemented new method for Account status subscription `accountsProvider.subscribeAccountConnectionStatus`

Scale
- New `Record` codec
  ```ts
  const record = Record(u8); // <= Codec<{ [K: string]: number }>
  ```
- New `lazy` codec for recursive types
  ```ts
  type NodeType = { c: NodeType | void }

  const Node: Codec<NodeType> = Struct({
    c: Option(lazy(() => Node)),
  });
  ```

Chore:
- More e2e tests for Host API
- Codebase cleanup


### ❤️ Thank You

- Ilya Kalinin
- Sergey Zhuravlev @johnthecat
- Yanaty

## 0.5.5 (2026-02-17)

### 🚀 Features

- papp integration ([#5](https://github.com/Polkadot-Community-Foundation/triangle-js-sdks/pull/5))
- Implemented correct Polkadot app pairing ui ([#6](https://github.com/Polkadot-Community-Foundation/triangle-js-sdks/pull/6))
- Support new statement store errors while submitting statements ([#8](https://github.com/Polkadot-Community-Foundation/triangle-js-sdks/pull/8))
- host api spec ([#7](https://github.com/Polkadot-Community-Foundation/triangle-js-sdks/pull/7))
- chat ([#9](https://github.com/Polkadot-Community-Foundation/triangle-js-sdks/pull/9))
- retry auth requests, add tests ([#12](https://github.com/Polkadot-Community-Foundation/triangle-js-sdks/pull/12))
- added clearAll method to localStorageAdapter ([#11](https://github.com/Polkadot-Community-Foundation/triangle-js-sdks/pull/11))
- add tr-ui, PairingPopover and theme support ([#10](https://github.com/Polkadot-Community-Foundation/triangle-js-sdks/pull/10))
- update sdk to 0.5 spec ([#13](https://github.com/Polkadot-Community-Foundation/triangle-js-sdks/pull/13))
- added a disconnect attempt and an error toast. PB-118 ([#15](https://github.com/Polkadot-Community-Foundation/triangle-js-sdks/pull/15))
- changes for 0.5 release ([55ba140](https://github.com/Polkadot-Community-Foundation/triangle-js-sdks/commit/55ba140))

### 🩹 Fixes

- Explicitly set account type to sr25519 in extension injector ([c942974](https://github.com/Polkadot-Community-Foundation/triangle-js-sdks/commit/c942974))
- pairing ui logos and texts ([d99f67d](https://github.com/Polkadot-Community-Foundation/triangle-js-sdks/commit/d99f67d))
- added Preview People Chain ([#14](https://github.com/Polkadot-Community-Foundation/triangle-js-sdks/pull/14))

### ❤️ Thank You

- Ilya Kalinin
- Sergey Zhuravlev @johnthecat
- Yanaty

## 0.5.4 (2026-02-05)

### 🚀 Features

- host-container: webview integration provider
- host-container: new interface for chain connections
- product-sdk: statement store integration
- product-sdk: accounts manager API
- product-sdk: chat manager API

### 🩹 Fixes

- correct disposal of chain connection ([01e3985](https://github.com/Polkadot-Community-Foundation/triangle-js-sdks/commit/01e3985))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.5.3-0 (2026-01-11)

### 🚀 Features

- papp integration ([#5](https://github.com/novasamatech/spektr-sdk/pull/5))
- Implemented correct Polkadot app pairing ui ([#6](https://github.com/novasamatech/spektr-sdk/pull/6))
- Support new statement store errors while submitting statements ([#8](https://github.com/novasamatech/spektr-sdk/pull/8))
- host api spec ([#7](https://github.com/novasamatech/spektr-sdk/pull/7))
- externalized scale helpers into separated library ([d8d3826](https://github.com/novasamatech/spektr-sdk/commit/d8d3826))
- host chat package WIP ([be14c03](https://github.com/novasamatech/spektr-sdk/commit/be14c03))

### 🩹 Fixes

- Explicitly set account type to sr25519 in extension injector ([c942974](https://github.com/novasamatech/spektr-sdk/commit/c942974))
- pairing ui logos and texts ([d99f67d](https://github.com/novasamatech/spektr-sdk/commit/d99f67d))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.5.2 (2026-01-08)

### 🩹 Fixes

- pairing ui logos and texts ([d99f67d](https://github.com/novasamatech/spektr-sdk/commit/d99f67d))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.5.1 (2026-01-06)

### 🩹 Fixes

- Explicitly set account type to sr25519 in extension injector ([c942974](https://github.com/novasamatech/spektr-sdk/commit/c942974))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.5.0 (2026-01-06)

### 🚀 Features

- Polkadot app integration ([#5](https://github.com/novasamatech/spektr-sdk/pull/5))
- Support new statement store errors while submitting statements ([#8](https://github.com/novasamatech/spektr-sdk/pull/8))
- Implemented Polkadot app pairing ui ([#6](https://github.com/novasamatech/spektr-sdk/pull/6))
- Host API according proposal ([#7](https://github.com/novasamatech/spektr-sdk/pull/7))
  - Chat integration API
  - Local Storage API

### ⚠️  Breaking Changes

- Completely new Host API spec that is not compatible with previous versions;
- New API of container from `host-container` package;
- `createSpektrPapiProvider` renamed to `createPapiProvider` in `product-sdk` package.

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.4.1 (2025-11-26)

### 🩹 Fixes

- simplified createTransaction codec ([6916a58](https://github.com/novasamatech/spektr-sdk/commit/6916a58))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.4.0 (2025-11-26)

### 🚀 Features

- new package names, removed shared package ([283640d](https://github.com/novasamatech/spektr-sdk/commit/283640d))

### ⚠️  Breaking Changes

- Package renaming
  - `@novasamatech/spektr-sdk` -> `@novasamatech/product-sdk`
  - `@novasamatech/spektr-dapp-host-container` -> `@novasamatech/host-container`
  - `@novasamatech/spektr-sdk-transport` -> `@novasamatech/host-api`
  - `@novasamatech/spektr-sdk-shared` -> Removed


### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.3.0 (2025-11-23)

### 🩹 Fixes

- Optimized hex encoding/decoding. ([017068e](https://github.com/novasamatech/spektr-sdk/commit/017068e))

### ⚠️  Breaking Changes

- Optimized hex encoding/decoding. Breaking change on transport layer.

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.2.0 (2025-11-23)

### 🚀 Features

- ⚠️  Support `createTransaction` interface ([3dc97ab](https://github.com/novasamatech/spektr-sdk/commit/3dc97ab))

### ⚠️  Breaking Changes

- `container.handleSignRequest` now has a required createTransaction method.
- `createIframeProvider` now accepts a params object instead of separate arguments.

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.1.0 (2025-11-22)

### 🚀 Features

- connection status listening ([2570ea2](https://github.com/novasamatech/spektr-sdk/commit/2570ea2))

### 🩹 Fixes

- husky config ([b175369](https://github.com/novasamatech/spektr-sdk/commit/b175369))
- node versions in github action ([7c0303c](https://github.com/novasamatech/spektr-sdk/commit/7c0303c))
- code style ([2e86aa4](https://github.com/novasamatech/spektr-sdk/commit/2e86aa4))

### ❤️ Thank You

- Sergey Zhuravlev @johnthecat

## 0.0.16 (2025-10-16)

First release with experimental API.
