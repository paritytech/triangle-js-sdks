# @novasamatech/substrate-slot-sr25519-wasm

Substrate sr25519 for **slot account secrets** (`privateKey || nonce`, 64 bytes) using `SecretKey::from_bytes`.

Matches Android/iOS Substrate SDK (`SlotAccountKey`, `createKeypairFromSecret`), unlike `@polkadot-labs/schnorrkel-wasm` which uses `from_ed25519_bytes`.

## Build

```bash
npm run build
```

Prebuilt wasm glue is committed in `wasm-glue/` and copied into `dist/nodejs/` during build. **Rust and wasm-pack are only required** when changing the Rust crate — run `npm run build:wasm` to regenerate `wasm-glue/` and commit the updated files.

The TypeScript API lives in `src/index.ts`.
