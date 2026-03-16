# CLAUDE.md

This file provides guidance for Claude Code when working in this repository.

## Project Overview

This is an Nx monorepo for the host-product integration SDKs — a set of TypeScript packages providing transport, messaging, and UI layers for embedding Polkadot ecosystem apps into a browser host.

**Repository:** `Polkadot-Community-Foundation/triangle-js-sdks`
**License:** Apache-2.0

## Packages

| Package | Path | Purpose                                             |
|---|---|-----------------------------------------------------|
| `@novasamatech/host-api` | `packages/host-api` | Core transport/messaging layer                      |
| `@novasamatech/host-container` | `packages/host-container` | Host container, manages embedded products           |
| `@novasamatech/host-chat` | `packages/host-chat` | Statement store chat integration                    |
| `@novasamatech/host-papp` | `packages/host-papp` | Polkadot app integration with crypto ops            |
| `@novasamatech/host-papp-react-ui` | `packages/host-papp-react-ui` | React UI components for papp flows                  |
| `@novasamatech/product-sdk` | `packages/product-sdk` | SDK for products integrating with the host          |
| `@novasamatech/product-react-renderer` | `packages/product-react-renderer` | React reconciler wrapper for custom messages format |
| `@novasamatech/scale` | `packages/scale` | Additional scale-ts codec bindings                  |
| `@novasamatech/statement-store` | `packages/statement-store` | Blockchain statement store integration              |
| `@novasamatech/storage-adapter` | `packages/storage-adapter` | Event-driven storage abstraction                    |
| `@novasamatech/host-api-test-sdk` | `packages/host-api-test-sdk` | Test host for E2E testing with auto-signing          |

## Common Commands

```bash
# Build
npm run build           # All packages
npm run build:watch     # Watch mode

# Test
npm test                # Run all tests with Vitest

# Lint & type-check
npm run lint            # ESLint (all packages + __tests__)
npm run lint:fix        # ESLint with auto-fix
npm run typecheck       # TypeScript type checking

# Release
npm run release         # Nx release (version bump)
```

Run `npm run build` before `typecheck` since typecheck depends on built artifacts from dependencies.

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
