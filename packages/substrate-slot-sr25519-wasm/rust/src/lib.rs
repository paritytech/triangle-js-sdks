//! Substrate `SecretKey::from_bytes` sr25519 (matches Android `SlotAccountKey` + `Sr25519.getPublicKeyFromSecret`).

use schnorrkel::{ExpansionMode, Keypair, MiniSecretKey, PublicKey, SecretKey, Signature};
use wasm_bindgen::prelude::*;

const CTX: &[u8] = b"substrate";

fn keypair_from_seed(seed: &[u8]) -> Result<Keypair, String> {
    MiniSecretKey::from_bytes(seed)
        .map_err(|e| format!("invalid seed: {e}"))
        .map(|mini| mini.expand_to_keypair(ExpansionMode::Ed25519))
}

fn secret_from_bytes(secret: &[u8]) -> Result<SecretKey, String> {
    SecretKey::from_bytes(secret).map_err(|e| format!("invalid sr25519 secret: {e}"))
}

/// Public key from a Substrate slot secret (`privateKey || nonce`, 64 bytes).
#[wasm_bindgen(js_name = substrateSr25519PublicKeyFromSecret)]
pub fn substrate_sr25519_public_key_from_secret(secret: &[u8]) -> Result<Vec<u8>, JsValue> {
    let sk = secret_from_bytes(secret).map_err(|e| JsValue::from_str(&e))?;
    Ok(sk.to_public().to_bytes().to_vec())
}

/// Sign with Substrate context using `SecretKey::from_bytes` (matches Android `Sr25519.sign`).
#[wasm_bindgen(js_name = substrateSr25519SignFromSecret)]
pub fn substrate_sr25519_sign_from_secret(secret: &[u8], message: &[u8]) -> Result<Vec<u8>, JsValue> {
    let sk = secret_from_bytes(secret).map_err(|e| JsValue::from_str(&e))?;
    let pk = sk.to_public();
    Ok(sk.sign_simple(CTX, message, &pk).to_bytes().to_vec())
}

/// `[privateKey || nonce]` from a Substrate keypair seed (matches Android `SlotAccountKey` wiring).
#[wasm_bindgen(js_name = substrateSlotSecretFromSeed)]
pub fn substrate_slot_secret_from_seed(seed: &[u8]) -> Result<Vec<u8>, JsValue> {
    let kp = keypair_from_seed(seed).map_err(|e| JsValue::from_str(&e))?;
    let bytes = kp.to_bytes();
    Ok(bytes[0..64].to_vec())
}

/// Verify a Substrate-context signature.
#[wasm_bindgen(js_name = substrateSr25519Verify)]
pub fn substrate_sr25519_verify(public_key: &[u8], message: &[u8], signature: &[u8]) -> Result<bool, JsValue> {
    let pk = PublicKey::from_bytes(public_key).map_err(|e| JsValue::from_str(&format!("invalid pubkey: {e}")))?;
    let sig = Signature::from_bytes(signature).map_err(|e| JsValue::from_str(&format!("invalid signature: {e}")))?;
    Ok(pk.verify_simple(CTX, message, &sig).is_ok())
}
