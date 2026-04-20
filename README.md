# Collection of SDKs for developing Polkadot applications

> [!WARNING]
> **🔬 Proof of Concept**
> 
> This project is currently a **Proof of Concept (POC)** implementation. It is intended for experimental and demonstration purposes. Features, APIs, and architecture may change significantly as the project evolves. Not recommended for production use at this stage.

## Specification

* [**Host API protocol**](./docs/design/host-api-protocol.md) — source of truth for the host ↔ product integration protocol.

## Packages

### For Product developers
* [**product-sdk**](./packages/product-sdk/README.md) — SDK for integrating and running a product inside the Polkadot browser host.
* [**product-react-renderer**](./packages/product-react-renderer/README.md) — Custom React reconciler for rendering native UI widgets from product scripts.

### For Host developers
* [**host-api**](./packages/host-api/README.md) — Transport implementation for host ↔ product integration.
* [**host-container**](./packages/host-container/README.md) — Host-side container for hosting and managing products within the Polkadot ecosystem.
* [**host-papp**](./packages/host-papp/README.md) — Polkadot app integration layer for the host.
* [**host-papp-react-ui**](./packages/host-papp-react-ui/README.md) — React UI flow for the Polkadot app integration.
* [**host-worker-sandbox**](./packages/host-worker-sandbox/README.md) — QuickJS-based sandbox for running product worker code in an isolated VM.
* [**host-substrate-chain-connection**](./packages/host-substrate-chain-connection/README.md) — Ref-counted `polkadot-api` connection pool with shared WebSocket/light-client lifecycle.

### Shared libraries
* [**handoff-service**](./packages/handoff-service/README.md) — HOP (Handoff Pool) P2P file transfer service with end-to-end encryption over the Bulletin chain.
* [**statement-store**](./packages/statement-store/README.md) — Encrypted, signed request/response messaging sessions over a Polkadot statement store.
* [**storage-adapter**](./packages/storage-adapter/README.md) — Pluggable key/value storage adapters (in-memory, localStorage) with typed field views.
* [**scale**](./packages/scale/README.md) — Additional SCALE codecs built on top of `scale-ts`.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for release history.

## Contribution

See [CONTRIBUTING.md](./CONTRIBUTING.md) for more information.
