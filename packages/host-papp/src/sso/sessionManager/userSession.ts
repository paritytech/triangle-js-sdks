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

import type { RemoteMessage } from './scale/remoteMessage.js';
import { RemoteMessageCodec } from './scale/remoteMessage.js';
import type { ApAllocationOutcome, ResourceAllocationRequest } from './scale/resourceAllocation.js';
import type { SigningPayloadRequest, SigningRawRequest } from './scale/signingRequest.js';
import type { SigningPayloadResponseData } from './scale/signingResponse.js';

// Timeout for the inner queue task. Without it the queue wedges forever when
// the remote signer doesn't respond — e.g. the request
// payload is for an SDK version the mobile app doesn't support yet. After
// this timeout the queue task fails, freeing the pool for the next request.
const QUEUE_TASK_TIMEOUT_MS = 180_000;

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
  signPayload(payload: SigningPayloadRequest): ResultAsync<SigningPayloadResponseData, Error>;
  signRaw(payload: SigningRawRequest): ResultAsync<SigningPayloadResponseData, Error>;
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

  const session = createSession({
    localAccount: userSession.localAccount,
    remoteAccount: userSession.remoteAccount,
    statementStore,
    encryption,
    prover,
  });

  const processedMessages = fieldListView<string>({
    storage,
    key: `sso_processed_${userSession.id}`,
    from: JSON.parse,
    to: JSON.stringify,
  });

  return {
    id: userSession.id,
    localAccount: userSession.localAccount,
    remoteAccount: userSession.remoteAccount,
    rootAccountId: userSession.rootAccountId,

    signPayload(payload) {
      return requestQueue.call(() => {
        const messageId = nanoid();
        emitHostAction(messageId, 'SignRequest:Payload', userSession.id);
        const request = session.request(RemoteMessageCodec, {
          messageId,
          data: enumValue('v1', enumValue('SignRequest', enumValue('Payload', payload))),
        });

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
      return requestQueue.call(() => {
        const messageId = nanoid();
        emitHostAction(messageId, 'SignRequest:Raw', userSession.id);
        const request = session.request(RemoteMessageCodec, {
          messageId,
          data: enumValue('v1', enumValue('SignRequest', enumValue('Raw', payload))),
        });

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

    sendDisconnectMessage() {
      return requestQueue.call(() =>
        session
          .submitRequestMessage(RemoteMessageCodec, {
            messageId: nanoid(),
            data: enumValue('v1', enumValue('Disconnected', undefined)),
          })
          .map(() => undefined),
      );
    },

    getRingVrfAlias(productAccountId, productId) {
      return requestQueue.call(() => {
        const messageId = nanoid();
        emitHostAction(messageId, 'RingVrfAliasRequest', userSession.id);
        const request = session.request(RemoteMessageCodec, {
          messageId,
          data: enumValue(
            'v1',
            enumValue('RingVrfAliasRequest', {
              productAccountId,
              productId,
            }),
          ),
        });

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
      return requestQueue.call(() => {
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
                const actionKind =
                  payload.value.data.tag === 'v1' ? payload.value.data.value.tag : payload.value.data.tag;
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

    dispose() {
      return session.dispose();
    },
  };
}
