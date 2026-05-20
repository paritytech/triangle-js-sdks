declare module './nodejs/substrate_sr25519_wasm.js' {
  export default function init(
    module_or_path?: URL | RequestInfo | { module_or_path: URL | RequestInfo },
  ): Promise<unknown>;

  export function initSync(module?: WebAssembly.Module | { module: WebAssembly.Module }): unknown;

  export function substrateSlotSecretFromSeed(seed: Uint8Array): Uint8Array;

  export function substrateSr25519PublicKeyFromSecret(secret: Uint8Array): Uint8Array;

  export function substrateSr25519SignFromSecret(secret: Uint8Array, message: Uint8Array): Uint8Array;

  export function substrateSr25519Verify(
    public_key: Uint8Array,
    message: Uint8Array,
    signature: Uint8Array,
  ): boolean;
}
