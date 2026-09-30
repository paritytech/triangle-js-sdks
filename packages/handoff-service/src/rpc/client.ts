import { fromHex, toHex } from '@polkadot-api/utils';
import type { ResultAsync } from 'neverthrow';
import { fromPromise } from 'neverthrow';

import { MultiSignature, MultiSigner } from './scale.js';
import type { HexString, PoolStatus, RequestFn } from './types.js';

export type HopClient = {
  submit(data: Uint8Array, recipients: Uint8Array[]): ResultAsync<PoolStatus, Error>;
  claim(hash: Uint8Array, signature: Uint8Array): ResultAsync<Uint8Array, Error>;
  ack(hash: Uint8Array, signature: Uint8Array): ResultAsync<null, Error>;
  poolStatus(): ResultAsync<PoolStatus, Error>;
  /**
   * `bitswap_v1_get` — fetch a promoted (on-chain) entry by CID (chat RFC
   * 0001). Exposed on the same connection as the hop_* methods; nodes
   * referenced in messages MUST serve both.
   */
  bitswapGet(cid: string): ResultAsync<Uint8Array, Error>;
};

/**
 * Error codes returned by the `hop_*` methods (`substrate/client/hop/src/types.rs`).
 * These live in a different space from `BitswapErrorCode` — the same condition
 * has a different number on each RPC, so the two tables must not be conflated.
 */
export const HopErrorCode = {
  /** The pool no longer holds this entry — it may have been promoted on-chain. */
  notFound: 1004,
} as const;

/**
 * JSON-RPC failure with the server error code preserved, so callers can
 * distinguish `NotFound` (fall back / retry) from terminal errors. Constructed
 * only when the server actually reported a code, so `instanceof HopRpcError`
 * alone proves the code is available.
 */
export class HopRpcError extends Error {
  readonly code: number;

  constructor(message: string, code: number) {
    super(message);
    this.name = 'HopRpcError';
    this.code = code;
  }
}

function toHexString(bytes: Uint8Array): HexString {
  return toHex(bytes) as HexString;
}

function encodeSr25519Signer(publicKey: Uint8Array): HexString {
  return toHexString(MultiSigner.enc({ tag: 'sr25519', value: publicKey }));
}

function encodeSr25519Signature(signature: Uint8Array): HexString {
  return toHexString(MultiSignature.enc({ tag: 'sr25519', value: signature }));
}

function toError(e: unknown): Error {
  if (typeof e === 'object' && e !== null) {
    const { code, message } = e as { code?: unknown; message?: unknown };
    if (typeof code === 'number') {
      return new HopRpcError(message === undefined ? String(e) : String(message), code);
    }
  }
  return e instanceof Error ? e : new Error(String(e));
}

export function createHopClient(requestFn: RequestFn): HopClient {
  return {
    submit(data, recipients) {
      const encodedRecipients = recipients.map(r => encodeSr25519Signer(r));

      return fromPromise(
        requestFn<PoolStatus>('hop_submit', [toHexString(data), encodedRecipients, '0x' as HexString]),
        toError,
      );
    },

    claim(hash, signature) {
      return fromPromise(
        requestFn<HexString>('hop_claim', [toHexString(hash), encodeSr25519Signature(signature)]).then(hex =>
          fromHex(hex),
        ),
        toError,
      );
    },

    ack(hash, signature) {
      // hop_ack acknowledges a successful claim so the server can evict the
      // entry. Android calls this after every successful claim; failure is
      // non-fatal for the receiver (best-effort cleanup).
      return fromPromise(
        requestFn('hop_ack', [toHexString(hash), encodeSr25519Signature(signature)]).then(() => null),
        toError,
      );
    },

    poolStatus() {
      return fromPromise(requestFn<PoolStatus>('hop_poolStatus', []), toError);
    },

    bitswapGet(cid) {
      return fromPromise(
        requestFn<HexString>('bitswap_v1_get', [cid]).then(hex => fromHex(hex)),
        toError,
      );
    },
  };
}
