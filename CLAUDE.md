# CLAUDE.md

This file provides guidance for Claude Code when working in this repository.

## Project Overview

This is an Nx monorepo for the host-product integration SDKs — a set of TypeScript packages providing transport, messaging, and UI layers for embedding Polkadot ecosystem apps into a browser host.

**Repository:** `paritytech/triangle-js-sdks`
**License:** Apache-2.0

### Glossary

- **host** — the embedding browser application (e.g. a wallet/SSO surface). Owns the page and runs `host-container`, `host-api`, etc.
- **product** — a Polkadot ecosystem app embedded inside the host. Built against `product-sdk`; its worker code runs inside `host-worker-sandbox`.
- **papp** — short for "Polkadot Mobile". `host-papp` is the host-side integration layer that pairs with it via deeplink handshake and routes signing requests.

## Common Commands

```bash
# Build
npm run build           # All packages
npm run build:watch     # Watch mode

# Test
npm test                # Run all tests with Vitest (per-package + __tests__/)

# Lint & type-check
npm run lint            # ESLint (all packages + __tests__)
npm run lint:fix        # ESLint with auto-fix
npm run typecheck       # TypeScript type checking

# Other
npm run storybook:papp  # Storybook for host-papp-react-ui
npm run knip            # Detect unused exports/files/deps

# Release
npm run release         # Nx release (version bump)
```

Run `npm run build` before `typecheck` since typecheck depends on built artifacts from dependencies.

`prepublishOnly` runs `build && lint && test` — publishing is gated on all three, not just `npm test`.

### Tests

- **Per-package unit tests** live next to source under `packages/*/src/**/*.spec.ts`.
- **Integration tests** live in top-level `__tests__/` and exercise full host ↔ product flows across packages (transport, container, product-sdk wired together). Shared test helpers live in `__tests__/hostApi/__mocks__/`.

## Tech Stack

- **Language:** TypeScript
- **Module system:** Node ESM (`moduleResolution: nodenext`)
- **Build:** Nx + Vite
- **Test:** Vitest
- **Lint:** ESLint + TypeScript ESLint + Prettier
- **Node version:** 24 (see `.nvmrc`)
- **Package manager:** npm workspaces

## Code Conventions

### TypeScript
- Strict mode
- Prefix intentionally unused variables with `_`
- Prefer named exports over default exports
- Error handling uses `neverthrow` (`Result`/`ok`/`err`) — avoid throwing

## Architecture Notes

- Packages are buildable libraries — always run `npm run build` before testing dependent packages
- Crypto primitives use `@noble/*` libraries (hashes, ciphers, curves, sr25519)
- Polkadot chain interactions use `polkadot-api` (not the older `@polkadot/api`)

## Implementation Notes

- **IMPORTANT**: `docs/design/host-api-protocol.md` is the source of truth for the host ↔ product protocol. Any protocol change must land in the specification first, then be synced to `host-api` and any other affected packages — never the other way around.
