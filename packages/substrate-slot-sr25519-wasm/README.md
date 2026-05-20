# @novasamatech/substrate-slot-sr25519-wasm

Substrate sr25519 for **slot account secrets** (`privateKey || nonce`, 64 bytes) using `SecretKey::from_bytes`.

Matches Android/iOS Substrate SDK (`SlotAccountKey`, `createKeypairFromSecret`), unlike `@polkadot-labs/schnorrkel-wasm` which uses `from_ed25519_bytes`.

## Build

Requires [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) and Rust.

```bash
npm run build
```

WASM glue is generated into `dist/nodejs/`; the TypeScript API lives in `src/index.ts`.
