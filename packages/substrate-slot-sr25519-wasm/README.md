# @novasamatech/substrate-slot-sr25519-wasm

Substrate sr25519 for **slot account secrets** (`privateKey || nonce`, 64 bytes) using `SecretKey::from_bytes`.

Matches Android/iOS Substrate SDK (`SlotAccountKey`, `createKeypairFromSecret`), unlike `@polkadot-labs/schnorrkel-wasm` which uses `from_ed25519_bytes`.

## Build

```bash
npm run build
```

`npm run build` runs `vite build` in library mode: it bundles `src/index.ts` into a single
self-contained `dist/index.js` with the wasm inlined as a `data:` URL. Inlining keeps the package
free of vite-specific runtime globals (no `__vitePreload`) and of `node:fs` fallbacks, so it loads
on any platform that has `fetch` — Node, browsers, workers — via one async init path. The prebuilt
wasm-bindgen glue is committed in `wasm/` and imported directly by `src/index.ts`.

**Rust and wasm-pack are only required** when changing the Rust crate — run `npm run build:wasm` to
regenerate `wasm/` (via a throwaway `.wasm-glue-build/` dir) and commit the updated files.

The TypeScript API lives in `src/index.ts`.
