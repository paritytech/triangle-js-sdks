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
};

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
  };
}
