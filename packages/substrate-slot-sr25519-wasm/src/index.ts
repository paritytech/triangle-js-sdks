import initWasm, {
  initSync as initWasmSync,
  substrateSlotSecretFromSeed,
  substrateSr25519PublicKeyFromSecret,
  substrateSr25519SignFromSecret,
  substrateSr25519Verify,
} from './nodejs/substrate_sr25519_wasm.js';

const wasmModuleUrl = new URL('./nodejs/substrate_sr25519_wasm_bg.wasm', import.meta.url);

let initDone = false;
let initPromise: Promise<void> | null = null;

const initSlotWasm = async () => {
  if (process.env.VITEST === 'true') {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    initWasmSync({ module: readFileSync(fileURLToPath(wasmModuleUrl)) });

    return;
  }

  await initWasm({ module_or_path: wasmModuleUrl });
};

/** Initialize WASM (call from host startup / tests). */
export function ensureSubstrateSlotSr25519Ready(): Promise<void> {
  if (initDone) {
    return Promise.resolve();
  }

  if (!initPromise) {
    initPromise = initSlotWasm().then(() => {
      initDone = true;
    });
  }

  return initPromise;
}

function assertReady() {
  if (!initDone) {
    throw new Error('substrate slot sr25519 wasm not initialized — call ensureSubstrateSlotSr25519Ready() first');
  }
}

/** `SecretKey::from_bytes` — Android `SlotAccountKey` (`privateKey || nonce`). */
export function deriveSlotAccountPublicKey(secret: Uint8Array): Uint8Array {
  assertReady();

  return substrateSr25519PublicKeyFromSecret(secret);
}

export function signSlotAccountSecret(secret: Uint8Array, message: Uint8Array): Uint8Array {
  assertReady();

  return substrateSr25519SignFromSecret(secret, message);
}

export function verifySlotAccountSignature(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
  assertReady();

  return substrateSr25519Verify(publicKey, message, signature);
}

/** Test helper: slot secret bytes for a seed (Substrate `Keypair::to_bytes()[0..64]`). */
export function substrateSlotSecretFromSeedBytes(seed: Uint8Array): Uint8Array {
  assertReady();

  return substrateSlotSecretFromSeed(seed);
}
