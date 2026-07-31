/**
 * Builds the statement body for an outgoing request/response.
 *
 * Two wire formats behind one interface — single-device (`StatementData.request`/
 * `.response`) and multi-device (`.multiRequest`/`.multiResponse`, wrapped per recipient
 * device). Fixed at session construction; the driver never branches on format.
 *
 * The builder is also the session's SIZE ORACLE. The driver builds the body it is about
 * to submit and measures `body.data.length`, so AEAD expansion and per-device envelope
 * fan-out are counted by construction — the two things a pre-encryption byte estimate
 * misses, and the reason a multi-device batch cannot be sized from raw message bytes.
 * On the happy path the measured body is the one submitted, so the check costs nothing.
 */

import type { Result } from 'neverthrow';
import { fromThrowable } from 'neverthrow';
import type { CodecType } from 'scale-ts';

import { khash, stringToBytes } from '../../crypto.js';
import { toError } from '../../helpers.js';
import type { SessionId } from '../../model/session.js';
import type { Encryption } from '../encyption.js';
import type { ResponseStatus } from '../scale/statementData.js';
import { Request, RequestDeviceInfo, Response, StatementData } from '../scale/statementData.js';

import type { DeviceTarget, Envelope } from './envelope.js';

type DeviceEntry = CodecType<typeof RequestDeviceInfo>;
type StatementDataValue = CodecType<typeof StatementData>;

export type StatementBody = {
  channel: Uint8Array;
  topics: Uint8Array[];
  data: Uint8Array;
};

export type OutgoingBodyBuilder = {
  buildRequest(requestId: string, messages: Uint8Array[]): Result<StatementBody, Error>;
  buildResponse(requestId: string, responseCode: ResponseStatus): Result<StatementBody, Error>;
};

const REQUEST_LABEL = stringToBytes('request');
const RESPONSE_LABEL = stringToBytes('response');

const encodeStatementData = fromThrowable(StatementData.enc, toError);
const encodeRequest = fromThrowable(Request.enc, toError);
const encodeResponse = fromThrowable(Response.enc, toError);

export function createRequestChannel(sessionId: Uint8Array) {
  return khash(sessionId, REQUEST_LABEL);
}

export function createResponseChannel(sessionId: Uint8Array) {
  return khash(sessionId, RESPONSE_LABEL);
}

/**
 * Omit `multiDevice` for the single-device format (`StatementData.request`/`.response`
 * straight under the pairwise encryption). Supply it to wrap the inner `Request`/`Response`
 * for every recipient device first (mds.md §"Sending P2P Messages"); the outer encryption
 * layer is the same either way.
 *
 * `recipients` is a thunk so a peer roster change is picked up on the next submit without
 * rebuilding the session.
 */
export function createBodyBuilder({
  topic,
  encryption,
  multiDevice,
}: {
  topic: SessionId;
  encryption: Encryption;
  multiDevice?: { envelope: Envelope; recipients: () => DeviceTarget[] };
}): OutgoingBodyBuilder {
  const requestChannel = createRequestChannel(topic);
  const responseChannel = createResponseChannel(topic);

  const seal = (channel: Uint8Array, payload: Result<Uint8Array, Error>): Result<StatementBody, Error> =>
    payload.andThen(encryption.encrypt).map(data => ({ channel, topics: [topic], data }));

  // Wrap an inner Request/Response into its multi-device StatementData variant.
  const wrap = (
    md: NonNullable<typeof multiDevice>,
    inner: Result<Uint8Array, Error>,
    toStatementData: (encryptedPayload: Uint8Array, devicesInfo: DeviceEntry[]) => StatementDataValue,
  ) =>
    inner
      .andThen(bytes => md.envelope.wrap(bytes, md.recipients()))
      .andThen(wrapped => encodeStatementData(toStatementData(wrapped.encryptedPayload, wrapped.devicesInfo)));

  return {
    buildRequest(requestId, messages) {
      return seal(
        requestChannel,
        multiDevice
          ? wrap(multiDevice, encodeRequest({ requestId, data: messages }), (encryptedRequest, devicesInfo) => ({
              tag: 'multiRequest',
              value: { encryptedRequest, devicesInfo },
            }))
          : encodeStatementData({ tag: 'request', value: { requestId, data: messages } }),
      );
    },

    buildResponse(requestId, responseCode) {
      return seal(
        responseChannel,
        multiDevice
          ? wrap(multiDevice, encodeResponse({ requestId, responseCode }), (encryptedResponse, devicesInfo) => ({
              tag: 'multiResponse',
              value: { encryptedResponse, devicesInfo },
            }))
          : encodeStatementData({ tag: 'response', value: { requestId, responseCode } }),
      );
    },
  };
}
