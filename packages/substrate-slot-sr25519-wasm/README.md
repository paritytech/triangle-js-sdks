# @novasamatech/substrate-slot-sr25519-wasm

Substrate sr25519 for **slot account secrets** (`privateKey || nonce`, 64 bytes) using `SecretKey::from_bytes`.

Matches Android/iOS Substrate SDK (`SlotAccountKey`, `createKeypairFromSecret`), unlike `@polkadot-labs/schnorrkel-wasm` which uses `from_ed25519_bytes`.

## Build

```bash
npm run build
```

`npm run build` runs `vite build`: it bundles `src/index.ts` into `dist/index.js` and emits the
wasm as a sibling asset `dist/substrate_slot_sr25519_wasm_bg.wasm` (not inlined). The prebuilt
wasm-bindgen glue is committed in `wasm-glue/` and imported directly by `src/index.ts`.

**Rust and wasm-pack are only required** when changing the Rust crate — run `npm run build:wasm` to
regenerate `wasm-glue/` (via a throwaway `.wasm-glue-build/` dir) and commit the updated files.

The TypeScript API lives in `src/index.ts`.
