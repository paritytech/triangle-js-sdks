import { blake2b } from '@noble/hashes/blake2.js';

/**
 * Domain-separated 32-byte payloads that the HOP node verifies for
 * submit/claim/ack. Byte layouts must remain identical to
 * `substrate/client/hop/src/types.rs` — `signing_payload` and
 * `submit_signing_payload` — and match the Android client
 * (`HopSigningPayloads` in `feature_chats_impl.data.hop`).
 *
 * Without this domain separation, the HOP server rejects the signature and
 * surfaces the failure as "Data not found" (the server doesn't reveal that
 * the data is present but the signature didn't verify).
 */
const textEncoder = new TextEncoder();
const SUBMIT_CONTEXT = textEncoder.encode('hop-submit-v1:');
const CLAIM_CONTEXT = textEncoder.encode('hop-claim-v1:');
const ACK_CONTEXT = textEncoder.encode('hop-ack-v1:');

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function blake2b256(data: Uint8Array): Uint8Array {
  return blake2b(data, { dkLen: 32 });
}

function u64LeBytes(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let v = value;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export const HopSigningPayloads = {
  submit(data: Uint8Array, submitTimestampMs: bigint): Uint8Array {
    return blake2b256(concat(SUBMIT_CONTEXT, blake2b256(data), u64LeBytes(submitTimestampMs)));
  },
  claim(hash: Uint8Array): Uint8Array {
    return blake2b256(concat(CLAIM_CONTEXT, hash));
  },
  ack(hash: Uint8Array): Uint8Array {
    return blake2b256(concat(ACK_CONTEXT, hash));
  },
};
