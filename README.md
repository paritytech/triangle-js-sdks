# Collection of SDKs for developing Polkadot applications

> The following is a prototype, reference implementation, and proof-of-concept. This open source code is provided for research, experimentation, and developer education only. This code has not been audited, is actively experimental, and may contain bugs, vulnerabilities, or incomplete features. Use at your own risk.

> [!NOTE]
> This implementation is suitable for **Web3 Summit** demonstration purposes, but is **not yet production ready**. Features, APIs, and architecture may still change significantly as the project evolves.

## Specification

* [**Host API protocol**](https://github.com/paritytech/truapi/tree/main/rust/crates/truapi) — source of truth for the host ↔ product integration protocol.

## Packages

### For Product developers
* [**host-api-wrapper**](./packages/host-api-wrapper/README.md) — Host API wrapper for integrating and running a product inside the Polkadot browser host.
* [**product-react-renderer**](./packages/product-react-renderer/README.md) — Custom React reconciler for rendering native UI widgets from product scripts.
* [**product-bulletin**](./packages/product-bulletin/README.md) — Bulletin Chain client adapter for product applications, wrapping `@parity/bulletin-sdk`.

### For Host developers
* [**host-api**](./packages/host-api/README.md) — Transport implementation for host ↔ product integration.
* [**host-container**](./packages/host-container/README.md) — Host-side container for hosting and managing products within the Polkadot ecosystem.
* [**host-papp**](./packages/host-papp/README.md) — Polkadot app integration layer for the host.
* [**host-papp-react-ui**](./packages/host-papp-react-ui/README.md) — React UI flow for the Polkadot app integration.
* [**host-chat**](./packages/host-chat/README.md) — Account lookup and chat-message codecs for host applications integrating with the Polkadot People chain.
* [**host-worker-sandbox**](./packages/host-worker-sandbox/README.md) — QuickJS-based sandbox for running product worker code in an isolated VM.
* [**host-substrate-chain-connection**](./packages/host-substrate-chain-connection/README.md) — Ref-counted `polkadot-api` connection pool with shared WebSocket/light-client lifecycle.

### Shared libraries
* [**handoff-service**](./packages/handoff-service/README.md) — HOP (Handoff Pool) P2P file transfer service with end-to-end encryption over the Bulletin chain.
* [**statement-store**](./packages/statement-store/README.md) — Encrypted, signed request/response messaging sessions over a Polkadot statement store.
* [**storage-adapter**](./packages/storage-adapter/README.md) — Pluggable key/value storage adapters (in-memory, localStorage) with typed field views.
* [**scale**](./packages/scale/README.md) — Additional SCALE codecs built on top of `scale-ts`.
* [**substrate-slot-sr25519-wasm**](./packages/substrate-slot-sr25519-wasm/README.md) — sr25519 WASM for slot-account secrets, matching the Android/iOS Substrate SDK `SlotAccountKey`.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for release history.

## Migration guides

* [**v0.7 → v0.8**](./docs/migration/v0.8.md)
* [**v0.6 → v0.7**](./docs/migration/v0.7.md)

## Contribution

See [CONTRIBUTING.md](./CONTRIBUTING.md) for more information.

## Security

These packages are reference SDKs, not a hardened, production-ready release. If you build on them, you are responsible
for:

- Reviewing the code yourself before relying on it; we publish a reference, not an audited library
- Pinning versions and keeping dependencies up to date and free of known vulnerabilities
- Securing the application you build with these SDKs
- Tracking the latest tagged releases for security fixes; older releases are not backported (exceptions might apply)

For Parity's security disclosure process and Bug Bounty program, see <https://parity.io/bug-bounty>.

