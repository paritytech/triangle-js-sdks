import type { Statement } from '@novasamatech/sdk-statement';
import { createExpiryFromDuration } from '@novasamatech/sdk-statement';
import { nanoid } from 'nanoid';
import { ResultAsync, err, errAsync, fromPromise, fromThrowable, ok, okAsync } from 'neverthrow';
import { toHex } from 'polkadot-api/utils';
import type { Codec, CodecType } from 'scale-ts';

import type { StatementStoreAdapter } from '../adapter/types.js';
import { khash, stringToBytes } from '../crypto.js';
import { nonNullable, toError } from '../helpers.js';
import type { SessionId } from '../model/session.js';
import { createSessionId } from '../model/session.js';
import type { LocalSessionAccount, RemoteSessionAccount } from '../model/sessionAccount.js';
import type { Callback } from '../types.js';

import type { Encryption } from './encyption.js';
import { DecodingError, DecryptionError, UnknownError } from './error.js';
import { toMessage } from './messageMapper.js';
import type { ResponseStatus } from './scale/statementData.js';
import { StatementData } from './scale/statementData.js';
import type { StatementProver } from './statementProver.js';
import type { Filter, Message, ResponseMessage, Session } from './types.js';

export type SessionParams = {
  localAccount: LocalSessionAccount;
  remoteAccount: RemoteSessionAccount;
  statementStore: StatementStoreAdapter;
  encryption: Encryption;
  prover: StatementProver;
  maxRequestSize?: number;
};

const DEFAULT_EXPIRY_DURATION_SECS = 7 * 24 * 60 * 60; // 7 days
const DEFAULT_MAX_REQUEST_SIZE = 4096;

export function nextExpiry(current: bigint): bigint {
  const fresh = createExpiryFromDuration(DEFAULT_EXPIRY_DURATION_SECS);
  return fresh > current ? fresh : current + 1n;
}

type Subscriber = {
  codec: Codec<unknown>;
  callback: Callback<Message<unknown>[]>;
};

type PendingDelivery = {
  resolve(r: ResponseMessage): void;
  reject(e: Error): void;
  promise: Promise<ResponseMessage>;
};

type OutgoingRequest = {
  // Every retransmit appends a fresh id; matching any of them resolves all
  // pending tokens so an early response to a superseded id is not lost.
  requestIds: string[];
  messages: Uint8Array[];
  tokens: string[];
};

type SessionState = {
  phase: 'initialization' | 'active' | 'failed';
  initError: Error | null;
  expiry: bigint;
  outgoingRequest: OutgoingRequest | null;
  incomingRequest: { requestId: string } | null;
  respondedIncomingRequest: boolean;
  messageQueue: Array<{ encoded: Uint8Array; token: string }>;
  pendingDelivery: Map<string, PendingDelivery>;
  seenStatements: Set<string>;
};

export function createSession({
  localAccount,
  remoteAccount,
  statementStore,
  encryption,
  prover,
  maxRequestSize = DEFAULT_MAX_REQUEST_SIZE,
}: SessionParams): Session {
  const outgoingSessionId = createSessionId(remoteAccount.publicKey, localAccount, remoteAccount);
  const incomingSessionId = createSessionId(remoteAccount.publicKey, remoteAccount, localAccount);

  const state: SessionState = {
    phase: 'initialization',
    initError: null,
    expiry: 0n,
    outgoingRequest: null,
    incomingRequest: null,
    respondedIncomingRequest: false,
    messageQueue: [],
    pendingDelivery: new Map(),
    seenStatements: new Set(),
  };

  let subscribers: Subscriber[] = [];
  const bufferedMessages: CodecType<typeof StatementData>[] = [];
  let storeUnsub: VoidFunction | null = null;
  let responseStoreUnsub: VoidFunction | null = null;

  function submitStatementAt(
    expiry: bigint,
    channel: Uint8Array,
    topicSessionId: SessionId,
    data: Uint8Array,
  ): ResultAsync<void, Error> {
    return encryption
      .encrypt(data)
      .map<Statement>(encrypted => ({
        expiry,
        channel: toHex(channel) as `0x${string}`,
        topics: [toHex(topicSessionId) as `0x${string}`],
        data: encrypted,
      }))
      .asyncAndThen(prover.generateMessageProof)
      .andThen(statementStore.submitStatement);
  }

  function submitStatementData(
    channel: Uint8Array,
    topicSessionId: SessionId,
    data: Uint8Array,
  ): ResultAsync<void, Error> {
    state.expiry = nextExpiry(state.expiry);
    return submitStatementAt(state.expiry, channel, topicSessionId, data);
  }

  function encodeAndSubmitRequest(requestId: string, messages: Uint8Array[]): void {
    const encode = fromThrowable(StatementData.enc, toError);
    encode({ tag: 'request', value: { requestId, data: messages } })
      .asyncAndThen(data => submitStatementData(createRequestChannel(outgoingSessionId), outgoingSessionId, data))
      .mapErr(e => {
        console.error('submitRequest failed:', e);
      });
  }

  function deliverStatementData(statementData: CodecType<typeof StatementData>): void {
    // Buffer 'request' statements unconditionally so that waitForRequestMessage
    // registered after delivery (race condition) still receives them via subscribe() replay.
    // Buffer everything else during initialization when there are no subscribers yet.
    if (statementData.tag === 'request' || (subscribers.length === 0 && state.phase === 'initialization')) {
      bufferedMessages.push(statementData);
    }

    if (subscribers.length === 0) return;

    for (const sub of subscribers) {
      const messages = toMessage(statementData, sub.codec);
      if (messages.length > 0) sub.callback(messages);
    }
  }

  function tryDecodeStatement(statement: Statement): ResultAsync<CodecType<typeof StatementData> | null, never> {
    if (!statement.data) return okAsync(null);
    const data = statement.data;
    return prover
      .verifyMessageProof(statement)
      .andThen(verified => (verified ? ok() : err(new Error('Invalid proof'))))
      .andThen(() => encryption.decrypt(data))
      .map(decrypted => StatementData.dec(decrypted))
      .orElse(() => ok(null));
  }

  function processIncomingStatement(statement: Statement, responsesOnly = false): void {
    if (!statement.data) return;
    const key = toHex(statement.data);
    if (state.seenStatements.has(key)) return;
    state.seenStatements.add(key);

    tryDecodeStatement(statement).andTee(statementData => {
      if (!statementData) return;

      if (statementData.tag === 'request') {
        if (responsesOnly) return;
        if (statementData.value.requestId === state.incomingRequest?.requestId) return;
        state.incomingRequest = { requestId: statementData.value.requestId };
        state.respondedIncomingRequest = false;
        deliverStatementData(statementData);
      } else if (statementData.tag === 'response') {
        if (!state.outgoingRequest?.requestIds.includes(statementData.value.requestId)) return;
        const responseMessage: ResponseMessage = {
          type: 'response',
          localId: statementData.value.requestId,
          requestId: statementData.value.requestId,
          responseCode: statementData.value.responseCode,
        };
        for (const token of state.outgoingRequest.tokens) {
          const deferred = state.pendingDelivery.get(token);
          if (deferred) {
            deferred.resolve(responseMessage);
            state.pendingDelivery.delete(token);
          }
        }
        state.outgoingRequest = null;
        deliverStatementData(statementData);
        processMessageQueue();
      }
    });
  }

  function processNewMessage(encoded: Uint8Array, token: string): void {
    if (state.outgoingRequest === null) {
      const requestId = nanoid();
      state.outgoingRequest = { requestIds: [requestId], messages: [encoded], tokens: [token] };
      encodeAndSubmitRequest(requestId, state.outgoingRequest.messages);
    } else {
      const currentTotal = state.outgoingRequest.messages.reduce((s, m) => s + m.length, 0);
      if (currentTotal + encoded.length <= maxRequestSize) {
        state.outgoingRequest.messages.push(encoded);
        state.outgoingRequest.tokens.push(token);
        const newRequestId = nanoid();
        state.outgoingRequest.requestIds.push(newRequestId);
        encodeAndSubmitRequest(newRequestId, state.outgoingRequest.messages);
      } else {
        state.messageQueue.push({ encoded, token });
      }
    }
  }

  function processMessageQueue(): void {
    while (state.messageQueue.length > 0) {
      const head = state.messageQueue[0]!;
      // Recompute per iteration; `processNewMessage` mutates outgoingRequest.messages in place.
      const currentTotal = state.outgoingRequest?.messages.reduce((s, m) => s + m.length, 0) ?? 0;
      if (state.outgoingRequest !== null && currentTotal + head.encoded.length > maxRequestSize) break;
      state.messageQueue.shift();
      processNewMessage(head.encoded, head.token);
    }
  }

  function ensureStoreSubscription(): void {
    if (storeUnsub) return;
    storeUnsub = statementStore.subscribeStatements({ matchAll: [incomingSessionId] }, page => {
      for (const statement of page.statements) {
        processIncomingStatement(statement);
      }
    });

    // Subscribe to outgoing topic to receive peer ACK responses.
    // Only process response-type statements — request-type statements on this topic
    // are our own submissions echoed back and must be ignored.
    responseStoreUnsub = statementStore.subscribeStatements({ matchAll: [outgoingSessionId] }, ({ statements }) => {
      for (const statement of statements) {
        processIncomingStatement(statement, true);
      }
    });
  }

  function rejectAllPending(error: Error): void {
    for (const [, deferred] of state.pendingDelivery) {
      deferred.reject(error);
    }
    state.pendingDelivery.clear();
  }

  function failInit(error: Error): void {
    state.phase = 'failed';
    state.initError = error;
    state.messageQueue = [];
    rejectAllPending(error);
  }

  async function init(): Promise<void> {
    const [ownResult, peerResult] = await Promise.all([
      statementStore.queryStatements({ matchAll: [outgoingSessionId] }),
      statementStore.queryStatements({ matchAll: [incomingSessionId] }),
    ]);

    if (ownResult.isErr()) {
      failInit(ownResult.error);
      return;
    }
    if (peerResult.isErr()) {
      failInit(peerResult.error);
      return;
    }

    const ownStatements = ownResult.value;
    const peerStatements = peerResult.value;

    let maxExpiry = 0n;
    for (const s of ownStatements) {
      if (s.expiry !== undefined && s.expiry > maxExpiry) maxExpiry = s.expiry;
    }
    state.expiry = nextExpiry(maxExpiry);

    for (const s of [...ownStatements, ...peerStatements]) {
      if (s.data) state.seenStatements.add(toHex(s.data));
    }

    const decodeAll = (statements: Statement[]) =>
      Promise.all(
        statements.map(s =>
          tryDecodeStatement(s).match(
            v => v,
            () => null,
          ),
        ),
      ).then(r => r.filter(nonNullable));

    const [ownDecoded, peerDecoded] = await Promise.all([decodeAll(ownStatements), decodeAll(peerStatements)]);

    const ownRequest = ownDecoded.find(d => d.tag === 'request');
    const ownResponse = ownDecoded.find(d => d.tag === 'response');
    const peerRequest = peerDecoded.find(d => d.tag === 'request');
    const peerResponse = peerDecoded.find(d => d.tag === 'response');

    if (ownRequest?.tag === 'request') {
      const hasResponse = ownResponse?.tag === 'response' && ownResponse.value.requestId === ownRequest.value.requestId;
      if (!hasResponse) {
        state.outgoingRequest = {
          requestIds: [ownRequest.value.requestId],
          messages: ownRequest.value.data,
          tokens: [], // tokens from previous session cannot be restored
        };
      }
    }

    if (peerRequest?.tag === 'request') {
      state.incomingRequest = { requestId: peerRequest.value.requestId };
      state.respondedIncomingRequest =
        peerResponse?.tag === 'response' && peerResponse.value.requestId === peerRequest.value.requestId;
    }

    // Notify app of any unresponded incoming request.
    // Delivered while phase is still 'initialization' so that deliverStatementData
    // buffers the message for replay if no subscriber is registered yet.
    if (peerRequest && state.incomingRequest && !state.respondedIncomingRequest) {
      deliverStatementData(peerRequest);
    }

    state.phase = 'active';
    processMessageQueue();
  }

  const session: Session = {
    request<T>(codec: Codec<T>, data: T) {
      return session
        .submitRequestMessage(codec, data)
        .andThen(({ requestId }) =>
          session.waitForResponseMessage(requestId).andThen(({ responseCode }) => mapResponseCode(responseCode)),
        );
    },

    submitRequestMessage<T>(codec: Codec<T>, message: T) {
      const encode = fromThrowable(codec.enc, toError);
      const encodedResult = encode(message);
      if (encodedResult.isErr()) return errAsync(encodedResult.error);

      const encoded = encodedResult.value;
      if (encoded.length > maxRequestSize) return errAsync(new Error('message too big'));

      if (state.phase === 'failed') {
        return errAsync(state.initError ?? new Error('Session initialization failed'));
      }

      const token = nanoid();
      let resolveFn!: (r: ResponseMessage) => void;
      let rejectFn!: (e: Error) => void;
      const promise = new Promise<ResponseMessage>((res, rej) => {
        resolveFn = res;
        rejectFn = rej;
      });
      state.pendingDelivery.set(token, { resolve: resolveFn, reject: rejectFn, promise });
      // Ensure a rejection from clearOutgoingStatement()/dispose() is always handled,
      // even when no caller attached via waitForResponseMessage(); the real waiter
      // still receives the rejection through its own handler.
      promise.catch(() => undefined);

      if (state.phase === 'initialization') {
        state.messageQueue.push({ encoded, token });
      } else {
        processNewMessage(encoded, token);
      }

      return okAsync({ requestId: token });
    },

    submitResponseMessage(requestId: string, responseCode: ResponseStatus) {
      if (state.respondedIncomingRequest) return okAsync(undefined);
      if (state.incomingRequest?.requestId !== requestId) {
        return errAsync(new Error(`No incoming request with id ${requestId}`));
      }
      state.respondedIncomingRequest = true;
      const encode = fromThrowable(StatementData.enc, toError);
      return encode({ tag: 'response', value: { requestId, responseCode } }).asyncAndThen(data =>
        submitStatementData(createResponseChannel(incomingSessionId), incomingSessionId, data),
      );
    },

    waitForRequestMessage<T, S>(codec: Codec<T>, filter: Filter<T, S>): ResultAsync<S, Error> {
      const promise = new Promise<S>(resolve => {
        const unsubscribe = session.subscribe(codec, messages => {
          for (const message of messages) {
            if (message.type !== 'request') continue;
            const payload = message.payload;
            if (payload.status !== 'parsed') continue;
            const filtered = filter(payload.value);
            if (filtered) {
              unsubscribe();
              resolve(filtered);
              break;
            }
          }
        });
      });
      return fromPromise(promise, toError);
    },

    waitForResponseMessage(token: string) {
      const deferred = state.pendingDelivery.get(token);
      if (!deferred) return errAsync(new Error(`No pending delivery for token ${token}`));
      return fromPromise(deferred.promise, toError);
    },

    subscribe<T>(codec: Codec<T>, callback: Callback<Message<T>[]>) {
      const sub: Subscriber = {
        codec: codec as Codec<unknown>,
        callback: callback as Callback<Message<unknown>[]>,
      };
      subscribers.push(sub);
      ensureStoreSubscription();

      // Deliver buffered init messages to this subscriber
      if (bufferedMessages.length > 0) {
        const messages = bufferedMessages.flatMap(sd => toMessage(sd, codec));
        if (messages.length > 0) callback(messages);
      }

      return () => {
        subscribers = subscribers.filter(s => s !== sub);
        if (subscribers.length === 0) {
          if (storeUnsub) {
            storeUnsub();
            storeUnsub = null;
          }
          if (responseStoreUnsub) {
            responseStoreUnsub();
            responseStoreUnsub = null;
          }
        }
      };
    },

    clearOutgoingStatement() {
      const outgoing = state.outgoingRequest;
      // Reuse the current expiry (do NOT call nextExpiry): the live batch was last
      // submitted at state.expiry, so an empty statement at the same expiry on the
      // same channel supersedes it. The store rejects only a strictly lower expiry.
      const expiry = state.expiry;

      // Always drop local outgoing state and reject pending waiters up-front,
      // regardless of which path follows. This covers messages queued before the
      // batch went out (e.g. during init, while outgoingRequest is still null) and
      // guarantees cleanup even if the superseding submission below fails — the
      // caller still receives any submission error.
      state.outgoingRequest = null;
      state.messageQueue = [];
      rejectAllPending(new Error('Outgoing batch aborted'));

      if (outgoing === null) return okAsync(undefined);

      const requestId = outgoing.requestIds[outgoing.requestIds.length - 1]!;
      const encoded = fromThrowable(
        StatementData.enc,
        toError,
      )({
        tag: 'request',
        value: { requestId, data: [] },
      });
      if (encoded.isErr()) return errAsync(encoded.error);

      return submitStatementAt(expiry, createRequestChannel(outgoingSessionId), outgoingSessionId, encoded.value);
    },

    dispose() {
      storeUnsub?.();
      storeUnsub = null;
      responseStoreUnsub?.();
      responseStoreUnsub = null;
      subscribers = [];
      rejectAllPending(new Error('Session disposed'));
    },
  };

  void init();

  return session;
}

function mapResponseCode(responseCode: ResponseStatus) {
  switch (responseCode) {
    case 'success':
      return ok();
    case 'decodingFailed':
      return err(new DecodingError());
    case 'decryptionFailed':
      return err(new DecryptionError());
    case 'unknown':
      return err(new UnknownError());
  }
}

function createRequestChannel(sessionId: Uint8Array) {
  return khash(sessionId, stringToBytes('request'));
}

function createResponseChannel(sessionId: Uint8Array) {
  return khash(sessionId, stringToBytes('response'));
}
