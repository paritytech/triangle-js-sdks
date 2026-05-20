import initSubstrateSr25519Wasm, {
  initSync as initSubstrateSr25519WasmSync,
  substrateSlotSecretFromSeed,
  substrateSr25519PublicKeyFromSecret,
  substrateSr25519SignFromSecret,
  substrateSr25519Verify as substrateSr25519VerifyBinding,
} from './wasm-substrate-sr25519/substrate_sr25519_wasm.js';

const wasmModuleUrl = new URL('./wasm-substrate-sr25519/substrate_sr25519_wasm_bg.wasm', import.meta.url);

let initDone = false;
let initPromise: Promise<void> | null = null;

const initWasm = async () => {
  if (process.env.VITEST === 'true') {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    initSubstrateSr25519WasmSync({ module: readFileSync(fileURLToPath(wasmModuleUrl)) });

    return;
  }

  await initSubstrateSr25519Wasm({ module_or_path: wasmModuleUrl });
};

/** Initialize wasm for Substrate slot-account crypto (call from host startup / tests). */
export function ensureSubstrateSlotSr25519Ready(): Promise<void> {
  if (initDone) {
    return Promise.resolve();
  }

  if (!initPromise) {
    initPromise = initWasm().then(() => {
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
export function substrateSlotPublicKey(secret: Uint8Array): Uint8Array {
  assertReady();

  return substrateSr25519PublicKeyFromSecret(secret);
}

export function substrateSlotSign(secret: Uint8Array, message: Uint8Array): Uint8Array {
  assertReady();

  return substrateSr25519SignFromSecret(secret, message);
}

export function substrateSlotVerify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
  assertReady();

  return substrateSr25519VerifyBinding(publicKey, message, signature);
}

/** Test helper: slot secret bytes for a seed (Substrate `Keypair::to_bytes()[0..64]`). */
export function substrateSlotSecretFromSeedBytes(seed: Uint8Array): Uint8Array {
  assertReady();

  return substrateSlotSecretFromSeed(seed);
}
