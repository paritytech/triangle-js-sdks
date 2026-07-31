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

import { khash, stringToBytes } from '../../crypto.js';
import { toError } from '../../helpers.js';
import type { SessionId } from '../../model/session.js';
import type { Encryption } from '../encyption.js';
import type { ResponseStatus } from '../scale/statementData.js';
import { Request, Response, StatementData } from '../scale/statementData.js';

import type { DeviceTarget, Envelope } from './envelope.js';

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

/** Single-device bodies: `StatementData.request` / `.response` under the pairwise encryption. */
export function createSingleBodyBuilder({
  topic,
  encryption,
}: {
  topic: SessionId;
  encryption: Encryption;
}): OutgoingBodyBuilder {
  const requestChannel = createRequestChannel(topic);
  const responseChannel = createResponseChannel(topic);

  const build = (channel: Uint8Array, payload: Uint8Array): Result<StatementBody, Error> =>
    encryption.encrypt(payload).map(data => ({ channel, topics: [topic], data }));

  return {
    buildRequest(requestId, messages) {
      return encodeStatementData({ tag: 'request', value: { requestId, data: messages } }).andThen(payload =>
        build(requestChannel, payload),
      );
    },
    buildResponse(requestId, responseCode) {
      return encodeStatementData({ tag: 'response', value: { requestId, responseCode } }).andThen(payload =>
        build(responseChannel, payload),
      );
    },
  };
}

/**
 * Multi-device bodies: the inner `Request`/`Response` is wrapped for every recipient
 * device, then the whole envelope is encrypted with the outer pairwise key — the same
 * outer layer the single-device path uses (mds.md §"Sending P2P Messages").
 *
 * `recipients` is a thunk so a peer roster change is picked up on the next submit without
 * rebuilding the session.
 */
export function createMultiDeviceBodyBuilder({
  topic,
  encryption,
  envelope,
  recipients,
}: {
  topic: SessionId;
  encryption: Encryption;
  envelope: Envelope;
  recipients: () => DeviceTarget[];
}): OutgoingBodyBuilder {
  const requestChannel = createRequestChannel(topic);
  const responseChannel = createResponseChannel(topic);

  return {
    buildRequest(requestId, messages) {
      return encodeRequest({ requestId, data: messages })
        .andThen(inner => envelope.wrap(inner, recipients()))
        .andThen(wrapped =>
          encodeStatementData({
            tag: 'multiRequest',
            value: { encryptedRequest: wrapped.encryptedPayload, devicesInfo: wrapped.devicesInfo },
          }),
        )
        .andThen(payload => encryption.encrypt(payload))
        .map(data => ({ channel: requestChannel, topics: [topic], data }));
    },
    buildResponse(requestId, responseCode) {
      return encodeResponse({ requestId, responseCode })
        .andThen(inner => envelope.wrap(inner, recipients()))
        .andThen(wrapped =>
          encodeStatementData({
            tag: 'multiResponse',
            value: { encryptedResponse: wrapped.encryptedPayload, devicesInfo: wrapped.devicesInfo },
          }),
        )
        .andThen(payload => encryption.encrypt(payload))
        .map(data => ({ channel: responseChannel, topics: [topic], data }));
    },
  };
}
