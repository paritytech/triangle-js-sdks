import * as schnorrkelWasm from '@polkadot-labs/schnorrkel-wasm';

const { sr25519_pubkey, sr25519_sign, sr25519_verify } = schnorrkelWasm;

/** Published .d.ts omits `init`; it is exported from the package entry at runtime. */
const initSchnorrkelWasm = (schnorrkelWasm as typeof schnorrkelWasm & { init: () => void }).init;

let initialized = false;

/** Ed25519-expanded sr25519 secrets (scure HDKD / `createSr25519Secret`). */
export function ensureSubstrateSr25519Ready() {
  if (!initialized) {
    initSchnorrkelWasm();
    initialized = true;
  }
}

export function substrateSr25519PublicKey(secret: Uint8Array): Uint8Array {
  ensureSubstrateSr25519Ready();

  return sr25519_pubkey(secret);
}

export function substrateSr25519Sign(secret: Uint8Array, message: Uint8Array): Uint8Array {
  ensureSubstrateSr25519Ready();
  const publicKey = sr25519_pubkey(secret);

  return sr25519_sign(publicKey, secret, message);
}

export function substrateSr25519Verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
  ensureSubstrateSr25519Ready();

  return sr25519_verify(publicKey, message, signature);
}
