/**
 * Statement → {@link TransportEvent} decoding, transparent across all four
 * `StatementData` variants.
 *
 * Every statement goes: verify proof → decrypt outer pairwise layer → decode
 * `StatementData`. Single-device variants (tags 0/1) are used directly; multi-device
 * variants (tags 2/3) are unwrapped through the {@link Envelope} first, then their inner
 * `Request`/`Response` is decoded.
 *
 * Two directions, because our own envelopes carry no entry addressed to us:
 *  - {@link StatementDecoder.decodePeer} — a peer's statement, decrypted with the topic's
 *    encryption and unwrapped against the sending device's encryption pubkey.
 *  - {@link StatementDecoder.decodeOwn} — one of our own statements read back from the
 *    store during initialization, decrypted with our outgoing encryption and unwrapped
 *    against a recipient device we wrapped it for.
 *
 * A statement whose outer layer decrypts but whose payload does not decode yields
 * `undecodable` with a best-effort `requestId`, so the caller can still NACK the sender
 * instead of leaving it waiting.
 */

import type { Statement } from '@novasamatech/sdk-statement';
import type { Result, ResultAsync } from 'neverthrow';
import { err, errAsync, fromThrowable, ok } from 'neverthrow';
import type { CodecType } from 'scale-ts';
import { Struct, str } from 'scale-ts';

import { toError } from '../../helpers.js';
import type { Encryption } from '../encyption.js';
import type { ResponseStatus } from '../scale/statementData.js';
import { Request, RequestDeviceInfo, Response, StatementData } from '../scale/statementData.js';
import type { StatementProver } from '../statementProver.js';

import type { DeviceTarget, Envelope } from './envelope.js';

export type TransportEvent =
  | { tag: 'request'; requestId: string; messages: Uint8Array[]; expiry: bigint | undefined }
  | { tag: 'response'; requestId: string; responseCode: ResponseStatus; expiry: bigint | undefined }
  /**
   * Outer decryption succeeded (so the sender is genuine) but the payload did not decode.
   * `requestId` is recovered when possible so the sender can be NACKed; `null` otherwise.
   */
  | { tag: 'undecodable'; requestId: string | null };

/** Everything needed to read statements arriving on one incoming topic. */
export type IncomingTopicSpec = {
  topic: Uint8Array;
  /** Encryption pubkey of the device publishing here — the envelope unwrap counterparty. */
  senderEncryptionPublicKey: Uint8Array;
  /** Outer pairwise encryption for this topic. */
  encryption: Encryption;
};

export type StatementDecoder = {
  decodePeer(statement: Statement, spec: IncomingTopicSpec): ResultAsync<TransportEvent, Error>;
  decodeOwn(statement: Statement, peerDevices: DeviceTarget[]): ResultAsync<TransportEvent, Error>;
};

type DeviceEntry = CodecType<typeof RequestDeviceInfo>;
/** Opens a multi-device envelope; the two directions differ only in which key they use. */
type UnwrapEnvelope = (encryptedPayload: Uint8Array, devicesInfo: DeviceEntry[]) => Result<Uint8Array, Error>;

const decodeStatementData = fromThrowable(StatementData.dec, toError);
const decodeRequest = fromThrowable(Request.dec, toError);
const decodeResponse = fromThrowable(Response.dec, toError);

// Best-effort recovery of the requestId from a decrypted-but-undecodable payload. The
// requestId is the first field after the enum tag, so it usually survives a corrupt body.
// Only requests (tag 0) carry an id worth answering; anything else returns null.
const RequestIdPrefix = Struct({ requestId: str });
const decodeRequestIdPrefix = fromThrowable(
  // slice (a copy), not subarray: scale-ts decodes from the backing buffer start and
  // ignores a view's byteOffset, so a subarray would be read from the wrong position.
  (decrypted: Uint8Array) => RequestIdPrefix.dec(decrypted.slice(1)).requestId,
  () => null,
);

function recoverRequestId(decrypted: Uint8Array): string | null {
  if (decrypted.length < 1 || decrypted[0] !== 0) return null;

  return decodeRequestIdPrefix(decrypted).unwrapOr(null);
}

function toRequestEvent(value: CodecType<typeof Request>, expiry: bigint | undefined): TransportEvent {
  return { tag: 'request', requestId: value.requestId, messages: value.data, expiry };
}

function toResponseEvent(value: CodecType<typeof Response>, expiry: bigint | undefined): TransportEvent {
  return { tag: 'response', requestId: value.requestId, responseCode: value.responseCode, expiry };
}

// An envelope we cannot open carries no recoverable requestId — the id lives inside it.
const UNOPENABLE: TransportEvent = { tag: 'undecodable', requestId: null };

export function createStatementDecoder({
  prover,
  envelope,
  ownEncryption,
}: {
  prover: StatementProver;
  envelope: Envelope;
  /** Outer encryption of our OWN outgoing statements — used only by {@link StatementDecoder.decodeOwn}. */
  ownEncryption: Encryption;
}): StatementDecoder {
  function decode(
    statement: Statement,
    encryption: Encryption,
    unwrap: UnwrapEnvelope,
  ): ResultAsync<TransportEvent, Error> {
    const data = statement.data;
    if (!data) return errAsync(new Error('decoder: statement carries no data'));

    return prover
      .verifyMessageProof(statement)
      .andThen(verified => (verified ? ok() : err(new Error('decoder: invalid statement proof'))))
      .andThen(() => encryption.decrypt(data))
      .map(decrypted => toEvent(decrypted, statement.expiry, unwrap));
  }

  function toEvent(decrypted: Uint8Array, expiry: bigint | undefined, unwrap: UnwrapEnvelope): TransportEvent {
    const decoded = decodeStatementData(decrypted);
    if (decoded.isErr()) return { tag: 'undecodable', requestId: recoverRequestId(decrypted) };

    const statementData = decoded.value;
    switch (statementData.tag) {
      case 'request':
        return toRequestEvent(statementData.value, expiry);
      case 'response':
        return toResponseEvent(statementData.value, expiry);
      case 'multiRequest':
        return unwrap(statementData.value.encryptedRequest, statementData.value.devicesInfo)
          .andThen(decodeRequest)
          .map(value => toRequestEvent(value, expiry))
          .unwrapOr(UNOPENABLE);
      case 'multiResponse':
        return unwrap(statementData.value.encryptedResponse, statementData.value.devicesInfo)
          .andThen(decodeResponse)
          .map(value => toResponseEvent(value, expiry))
          .unwrapOr(UNOPENABLE);
    }
  }

  return {
    decodePeer(statement, spec) {
      return decode(statement, spec.encryption, (payload, devicesInfo) =>
        envelope.unwrapForOwnDevice(payload, devicesInfo, spec.senderEncryptionPublicKey),
      );
    },

    decodeOwn(statement, peerDevices) {
      return decode(statement, ownEncryption, (payload, devicesInfo) =>
        envelope.unwrapOwn(payload, devicesInfo, peerDevices),
      );
    },
  };
}
