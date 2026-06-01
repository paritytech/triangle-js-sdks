import initWasm, {
  substrateSlotSecretFromSeed,
  substrateSr25519PublicKeyFromSecret,
  substrateSr25519SignFromSecret,
  substrateSr25519Verify,
} from '../wasm/substrate_slot_sr25519_wasm.js';

let initDone = false;
let initPromise: Promise<void> | null = null;

/**
 * Initialize WASM (call from host startup / tests).
 *
 * `initWasm()` with no argument resolves the wasm from the wasm-bindgen glue's own
 * `new URL('..._bg.wasm', import.meta.url)` default, which Vite's lib build inlines as a `data:`
 * URL. `fetch` resolves that `data:` URL on every target (Node ≥18, browsers, workers), so one
 * async path serves all platforms — no `node:fs`/`node:url` fallback, hence no dynamic `import()`
 * for the bundler to wrap in vite-specific preload globals.
 */
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
