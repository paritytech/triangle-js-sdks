import { ContextualAlias, ProductAccountId } from '@novasamatech/host-api';
import { enumValue } from '@novasamatech/scale';
import type { Encryption, StatementProver, StatementStoreAdapter } from '@novasamatech/statement-store';
import { createSession } from '@novasamatech/statement-store';
import type { StorageAdapter } from '@novasamatech/storage-adapter';
import { fieldListView } from '@novasamatech/storage-adapter';
import { nanoid } from 'nanoid';
import type { Result } from 'neverthrow';
import { ResultAsync, err, ok, okAsync } from 'neverthrow';
import type { CodecType } from 'scale-ts';

import { emitHostPappDebugMessage } from '../../debugBus.js';
import { createAsyncTaskPool } from '../../helpers/createAsyncTaskPool.js';
import { toError } from '../../helpers/utils.js';
import type { Callback } from '../../types.js';
import type { StoredUserSession } from '../userSessionRepository.js';

import type { CreateTransactionRequest } from './scale/createTransaction.js';
import type { RemoteMessage } from './scale/remoteMessage.js';
import { RemoteMessageCodec } from './scale/remoteMessage.js';
import type { ApAllocationOutcome, ResourceAllocationRequest } from './scale/resourceAllocation.js';
import type { SigningPayloadRequest, SigningPayloadResponseData, SigningRawRequest } from './scale/signing.js';

// Timeout for the inner queue task. Without it the queue wedges forever when
// the remote signer doesn't respond — e.g. the request
// payload is for an SDK version the mobile app doesn't support yet. After
// this timeout the queue task fails, freeing the pool for the next request.
const QUEUE_TASK_TIMEOUT_MS = 180_000;
// Mobile SSO statements allow 256 KiB total; keep headroom for statement/session overhead.
const MAX_SSO_REQUEST_SIZE = 254 * 1024;

function withQueueTimeout<T>(resultAsync: ResultAsync<T, Error>, label: string): ResultAsync<T, Error> {
  const timeoutPromise = new Promise<Result<T, Error>>(resolve =>
    setTimeout(() => resolve(err(new Error(`${label} timed out — queue freed`))), QUEUE_TASK_TIMEOUT_MS),
  );
  return ResultAsync.fromPromise(Promise.race([resultAsync, timeoutPromise]), toError).andThen(r => r);
}

type ProcessedMessage =
  | {
      processed: true;
      message: CodecType<typeof RemoteMessageCodec>;
    }
  | {
      processed: false;
    };

/**
 * Derive a stable `actionKind` label from a remote-message envelope.
 * Shape: `OuterTag` for flat variants, `OuterTag:InnerTag` for variants
 * whose payload is itself an enum (currently just `SignRequest`).
 * The receive side and the send side both go through here so debug
 * consumers see the same shape regardless of direction.
 */
function actionKindFromMessageData(data: CodecType<typeof RemoteMessageCodec>['data']): string {
  if (data.tag !== 'v1') return data.tag;
  const inner = data.value;
  if (inner.tag === 'SignRequest') return `SignRequest:${inner.value.tag}`;
  return inner.tag;
}

function emitHostAction(messageId: string, actionKind: string, sessionId: string): void {
  emitHostPappDebugMessage({
    layer: 'session',
    event: 'host_action_sent',
    flowId: messageId,
    timestamp: Date.now(),
    payload: { sessionId, messageId, actionKind },
  });
}

function withHostActionTrace<T>(
  result: ResultAsync<T, Error>,
  messageId: string,
  sessionId: string,
): ResultAsync<T, Error> {
  return result
    .andTee(() => {
      emitHostPappDebugMessage({
        layer: 'session',
        event: 'host_action_response_received',
        flowId: messageId,
        timestamp: Date.now(),
        payload: { sessionId, messageId },
      });
    })
    .orTee(error => {
      emitHostPappDebugMessage({
        layer: 'session',
        event: 'host_action_failed',
        flowId: messageId,
        timestamp: Date.now(),
        payload: { sessionId, messageId, reason: error.message },
      });
    });
}

export type UserSession = StoredUserSession & {
  sendDisconnectMessage(): ResultAsync<void, Error>;
  abortPendingRequests(): ResultAsync<void, Error>;
  signPayload(payload: SigningPayloadRequest): ResultAsync<SigningPayloadResponseData, Error>;
  signRaw(payload: SigningRawRequest): ResultAsync<SigningPayloadResponseData, Error>;
  createTransaction(payload: CreateTransactionRequest): ResultAsync<Uint8Array, Error>;
  getRingVrfAlias(
    productAccountId: CodecType<typeof ProductAccountId>,
    productId: string,
  ): ResultAsync<CodecType<typeof ContextualAlias>, Error>;
  requestResourceAllocation(request: ResourceAllocationRequest): ResultAsync<ApAllocationOutcome[], Error>;
  subscribe(callback: Callback<CodecType<typeof RemoteMessageCodec>, ResultAsync<boolean, Error>>): VoidFunction;
  dispose(): void;
};

export function createUserSession({
  userSession,
  statementStore,
  encryption,
  storage,
  prover,
}: {
  userSession: StoredUserSession;
  statementStore: StatementStoreAdapter;
  encryption: Encryption;
  storage: StorageAdapter;
  prover: StatementProver;
}): UserSession {
  const requestQueue = createAsyncTaskPool({ poolSize: 1, retryCount: 0, retryDelay: 0 });
  // Shared abort handle for everything currently on the request queue.
  // abortPendingRequests() fires it to drop the in-flight task plus anything
  // queued behind it, then swaps in a fresh controller so later requests aren't
  // pre-aborted.
  let requestAbort = new AbortController();
  // Enqueue against the live abort signal so abortPendingRequests() can drop every pending task.
  const enqueue = <T>(fn: () => ResultAsync<T, Error>) => requestQueue.call(fn, { signal: requestAbort.signal });

  const session = createSession({
    localAccount: userSession.localAccount,
    remoteAccount: userSession.remoteAccount,
    statementStore,
    encryption,
    prover,
    // V1 sessions historically derived SessionId by feeding the peer's raw
    // encryption pubkey into khash; preserve that behaviour here so existing
    // V1 channels stay byte-identical post-refactor. V2 callers (e.g.
    // polkadot-desktop's V2SsoSession) pass the ECDH-derived shared secret
    // explicitly per Mobile SSO spec v0.2.2.
    sessionKey: userSession.remoteAccount.publicKey,
    maxRequestSize: MAX_SSO_REQUEST_SIZE,
  });

  const processedMessages = fieldListView<string>({
    storage,
    key: `sso_processed_${userSession.id}`,
    from: JSON.parse,
    to: JSON.stringify,
  });

  return {
    ...userSession,

    signPayload(payload) {
      return enqueue(() => {
        const messageId = nanoid();
        const data = enumValue('v1', enumValue('SignRequest', enumValue('Payload', payload)));
        emitHostAction(messageId, actionKindFromMessageData(data), userSession.id);
        const request = session.request(RemoteMessageCodec, { messageId, data });

        const responseFilter = (message: RemoteMessage) => {
          if (
            message.data.tag === 'v1' &&
            message.data.value.tag === 'SignResponse' &&
            message.data.value.value.respondingTo === messageId
          ) {
            return message.data.value.value.payload;
          }
        };

        const inner = request
          .andThen(() => session.waitForRequestMessage(RemoteMessageCodec, responseFilter))
          .andThen(message => {
            if (message.success) {
              return ok(message.value);
            } else {
              return err(new Error(message.value));
            }
          });

        return withHostActionTrace(withQueueTimeout(inner, 'signPayload'), messageId, userSession.id);
      });
    },

    signRaw(payload) {
      return enqueue(() => {
        const messageId = nanoid();
        const data = enumValue('v1', enumValue('SignRequest', enumValue('Raw', payload)));
        emitHostAction(messageId, actionKindFromMessageData(data), userSession.id);
        const request = session.request(RemoteMessageCodec, { messageId, data });

        const responseFilter = (message: RemoteMessage) => {
          if (
            message.data.tag === 'v1' &&
            message.data.value.tag === 'SignResponse' &&
            message.data.value.value.respondingTo === messageId
          ) {
            return message.data.value.value.payload;
          }
        };

        const inner = request
          .andThen(() => session.waitForRequestMessage(RemoteMessageCodec, responseFilter))
          .andThen(message => {
            if (message.success) {
              return ok(message.value);
            } else {
              return err(new Error(message.value));
            }
          });

        return withHostActionTrace(withQueueTimeout(inner, 'signRaw'), messageId, userSession.id);
      });
    },

    createTransaction(payload) {
      return enqueue(() => {
        const messageId = nanoid();
        const request = session.request(RemoteMessageCodec, {
          messageId,
          data: enumValue('v1', enumValue('CreateTransactionRequest', payload)),
        });

        const responseFilter = (message: RemoteMessage) => {
          if (
            message.data.tag === 'v1' &&
            message.data.value.tag === 'CreateTransactionResponse' &&
            message.data.value.value.respondingTo === messageId
          ) {
            return message.data.value.value.signedTransaction;
          }
        };

        const inner = request
          .andThen(() => session.waitForRequestMessage(RemoteMessageCodec, responseFilter))
          .andThen(message => {
            if (message.success) {
              return ok(message.value);
            } else {
              return err(new Error(message.value));
            }
          });

        return withQueueTimeout(inner, 'createTransaction');
      });
    },

    sendDisconnectMessage() {
      return enqueue(() =>
        session
          .submitRequestMessage(RemoteMessageCodec, {
            messageId: nanoid(),
            data: enumValue('v1', enumValue('Disconnected', undefined)),
          })
          .map(() => undefined),
      );
    },

    getRingVrfAlias(productAccountId, productId) {
      return enqueue(() => {
        const messageId = nanoid();
        const data = enumValue(
          'v1',
          enumValue('RingVrfAliasRequest', {
            productAccountId,
            productId,
          }),
        );
        emitHostAction(messageId, actionKindFromMessageData(data), userSession.id);
        const request = session.request(RemoteMessageCodec, { messageId, data });

        const responseFilter = (message: RemoteMessage) => {
          if (
            message.data.tag === 'v1' &&
            message.data.value.tag === 'RingVrfAliasResponse' &&
            message.data.value.value.respondingTo === messageId
          ) {
            return message.data.value.value.payload;
          }
        };

        return withHostActionTrace(
          request
            .andThen(() => session.waitForRequestMessage(RemoteMessageCodec, responseFilter))
            .andThen(result => (result.success ? ok(result.value) : err(new Error(result.value)))),
          messageId,
          userSession.id,
        );
      });
    },

    requestResourceAllocation(request) {
      return enqueue(() => {
        const messageId = nanoid();
        const sendRequest = session.request(RemoteMessageCodec, {
          messageId,
          data: enumValue('v1', enumValue('ResourceAllocationRequest', request)),
        });

        const responseFilter = (message: RemoteMessage) => {
          if (
            message.data.tag === 'v1' &&
            message.data.value.tag === 'ResourceAllocationResponse' &&
            message.data.value.value.respondingTo === messageId
          ) {
            return message.data.value.value.payload;
          }
        };

        const inner = sendRequest
          .andThen(() => session.waitForRequestMessage(RemoteMessageCodec, responseFilter))
          .andThen(result => (result.success ? ok(result.value) : err(new Error(result.value))));

        return withQueueTimeout(inner, 'requestResourceAllocation');
      });
    },

    subscribe(callback: Callback<CodecType<typeof RemoteMessageCodec>, ResultAsync<boolean, Error>>) {
      return session.subscribe(RemoteMessageCodec, messages => {
        processedMessages
          .read()
          .andThen(processed => {
            const results = messages.map<ResultAsync<ProcessedMessage, Error>>(message => {
              if (message.type === 'request' && message.payload.status === 'parsed') {
                const payload = message.payload;

                const isMessageProcessed = processed.includes(payload.value.messageId);
                if (isMessageProcessed) {
                  return okAsync({ processed: false });
                }

                const messageId = payload.value.messageId;
                const actionKind = actionKindFromMessageData(payload.value.data);
                emitHostPappDebugMessage({
                  layer: 'session',
                  event: 'peer_action_received',
                  flowId: messageId,
                  timestamp: Date.now(),
                  payload: { sessionId: userSession.id, messageId, actionKind },
                });

                return callback(payload.value)
                  .andTee(processed => {
                    if (processed) {
                      emitHostPappDebugMessage({
                        layer: 'session',
                        event: 'peer_action_processed',
                        flowId: messageId,
                        timestamp: Date.now(),
                        payload: { sessionId: userSession.id, messageId },
                      });
                    }
                  })
                  .orTee(error => {
                    console.error('Error while processing sso message:', error);
                    emitHostPappDebugMessage({
                      layer: 'session',
                      event: 'peer_action_failed',
                      flowId: messageId,
                      timestamp: Date.now(),
                      payload: { sessionId: userSession.id, messageId, reason: error.message },
                    });
                  })
                  .orElse(() => okAsync(false))
                  .map(processed => (processed ? { processed, message: payload.value } : { processed }));
              }
              return okAsync({ processed: false });
            });

            return ResultAsync.combine(results).andThen(results => {
              const newMessages = results.filter(x => x.processed).map(x => x.message.messageId);
              if (newMessages.length > 0) {
                return processedMessages.mutate(x => x.concat(newMessages));
              }
              return okAsync();
            });
          })
          .orTee(error => {
            console.error('Error while updating processed sso messages:', error);
          });
      });
    },

    abortPendingRequests() {
      // Drop the whole request queue: aborting the shared signal rejects the
      // in-flight task and every request queued behind it, freeing the single
      // slot immediately instead of waiting out the per-task 180s timeout. Swap
      // in a fresh controller so subsequent requests aren't pre-aborted.
      requestAbort.abort(new Error('Session request aborted'));
      requestAbort = new AbortController();
      // Then supersede the in-flight on-chain batch with an empty one and reject
      // any session-level response waiters left orphaned by the dropped tasks.
      return session.clearOutgoingStatement();
    },

    dispose() {
      return session.dispose();
    },
  };
}
