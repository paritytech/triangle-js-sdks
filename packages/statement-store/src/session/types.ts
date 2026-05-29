import type { ResultAsync } from 'neverthrow';
import type { Codec } from 'scale-ts';

import type { Callback } from '../types.js';

import type { DecodingError } from './error.js';
import { DecryptionError, UnknownError } from './error.js';
import type { ResponseStatus } from './scale/statementData.js';

export type RequestPayload<T> =
  | {
      status: 'parsed';
      value: T;
    }
  | {
      status: 'failed';
      value: Uint8Array;
    };

export type RequestMessage<T> = {
  type: 'request';
  localId: string;
  requestId: string;
  payload: RequestPayload<T>;
};

export type ResponseMessage = {
  type: 'response';
  localId: string;
  requestId: string;
  responseCode: ResponseStatus;
};

export type Message<T> = RequestMessage<T> | ResponseMessage;

export type Filter<T, S> = (value: T) => S | undefined;

export type Session = {
  request<T>(codec: Codec<T>, payload: T): ResultAsync<void, DecodingError | DecryptionError | UnknownError | Error>;

  submitRequestMessage<T>(codec: Codec<T>, payload: T): ResultAsync<{ requestId: string }, Error>;
  submitResponseMessage(requestId: string, responseCode: ResponseStatus): ResultAsync<void, Error>;
  /**
   * Replace the in-flight outgoing request batch with an empty one on the same
   * request channel at the session's current expiry (the statement store keeps
   * one statement per channel and rejects only a LOWER expiry, so an equal/higher
   * expiry supersedes the live batch). Local outgoing state is always dropped and
   * all pending response waiters are rejected, including queued messages that have
   * not yet been submitted and even if the superseding submission itself fails.
   */
  clearOutgoingStatement(): ResultAsync<void, Error>;
  waitForRequestMessage<T, S>(codec: Codec<T>, filter: Filter<T, S>): ResultAsync<S, Error>;
  waitForResponseMessage(requestId: string): ResultAsync<ResponseMessage, Error>;
  subscribe<T>(codec: Codec<T>, callback: Callback<Message<T>[]>): VoidFunction;
  dispose(): void;
};
