import { compact, str } from 'scale-ts';

// Wire frame, as truapi's `frame.rs` defines it (RFC 0027):
//
//   [requestId: SCALE str][trait: u8][method: u8][message_type: u8][payload bytes...]
//
// `(trait, method)` addresses the method; `message_type` names which leg of
// its exchange the frame carries. The payload is that leg's own versioned
// wrapper, inlined with no length prefix: one transport message is one frame,
// so the payload runs to the end of it.

/**
 * `message_type` values. A request/response method uses `request`/`response`
 * (and `cancel`); a subscription uses `start`/`receive`/`interrupt`/`stop`. The
 * two families share `0` and `1`: which one applies follows from the method's
 * registered kind.
 */
export const MessageType = {
  request: 0,
  start: 0,
  response: 1,
  receive: 1,
  interrupt: 2,
  stop: 3,
  /** Withdraws a request; travels the same way as the request, with no payload. */
  cancel: 4,
} as const;

export type RequestLeg = 'request' | 'response' | 'cancel';
export type SubscriptionLeg = 'start' | 'receive' | 'interrupt' | 'stop';
export type MessageLeg = RequestLeg | SubscriptionLeg;

/** Reserved `(trait, method)` address for method-independent protocol errors. */
export const PROTOCOL_ERROR_TRAIT_ID = 255;
export const PROTOCOL_ERROR_METHOD_ID = 255;

export type Frame = {
  requestId: string;
  traitId: number;
  methodId: number;
  messageType: number;
  /** The leg's own SCALE-encoded payload. */
  payload: Uint8Array;
};

const EMPTY = new Uint8Array(0);

function assertByte(name: string, value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`Invalid wire ${name}: ${value}`);
  }
}

export function encodeFrame(frame: Frame): Uint8Array {
  assertByte('trait id', frame.traitId);
  assertByte('method id', frame.methodId);
  assertByte('message type', frame.messageType);

  const requestId = str.enc(frame.requestId);
  const bytes = new Uint8Array(requestId.length + 3 + frame.payload.length);
  bytes.set(requestId, 0);
  bytes[requestId.length] = frame.traitId;
  bytes[requestId.length + 1] = frame.methodId;
  bytes[requestId.length + 2] = frame.messageType;
  bytes.set(frame.payload, requestId.length + 3);
  return bytes;
}

// Byte length of the SCALE compact integer at the start of `bytes`.
function compactPrefixLength(bytes: Uint8Array): number {
  const first = bytes[0];
  if (first === undefined) throw new Error('frame is missing the request id');
  switch (first & 0b11) {
    case 0:
      return 1;
    case 1:
      return 2;
    case 2:
      return 4;
    default:
      return (first >> 2) + 5;
  }
}

export function decodeFrame(bytes: Uint8Array): Frame {
  const prefixLength = compactPrefixLength(bytes);
  if (bytes.length < prefixLength) throw new Error('frame request id is truncated');
  const idLength = Number(compact.dec(bytes.subarray(0, prefixLength)));
  const headerEnd = prefixLength + idLength;
  if (bytes.length < headerEnd + 3) {
    throw new Error('frame is missing its (trait, method, message type) header');
  }
  const requestId = new TextDecoder().decode(bytes.subarray(prefixLength, headerEnd));
  const [traitId = 0, methodId = 0, messageType = 0] = bytes.subarray(headerEnd, headerEnd + 3);
  const payload = bytes.length === headerEnd + 3 ? EMPTY : bytes.slice(headerEnd + 3);

  return { requestId, traitId, methodId, messageType, payload };
}

/** `VersionedProtocolError::V1(UnsupportedMessage { trait_id, method_id })`. */
export function encodeUnsupportedMessage(traitId: number, methodId: number): Uint8Array {
  return new Uint8Array([0, 0, traitId, methodId]);
}

/**
 * Decode a protocol-error payload. `null` is a protocol error this build does
 * not know (a later version or variant): the correlated call still settles,
 * and the connection stays up.
 */
export function decodeProtocolError(payload: Uint8Array): { traitId: number; methodId: number } | null {
  if (payload.length === 0) throw new Error('protocol error payload is empty');
  if (payload[0] !== 0 || (payload.length > 1 && payload[1] !== 0)) return null;
  const [, , traitId, methodId] = payload;
  if (payload.length !== 4 || traitId === undefined || methodId === undefined) {
    throw new Error('malformed UnsupportedMessage protocol error');
  }
  return { traitId, methodId };
}
