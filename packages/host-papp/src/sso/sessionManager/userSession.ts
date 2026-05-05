import { ContextualAlias, ProductAccountId } from '@novasamatech/host-api';
import type { HexString } from '@novasamatech/scale';
import { enumValue, toHex } from '@novasamatech/scale';
import type { Encryption, StatementProver, StatementStoreAdapter } from '@novasamatech/statement-store';
import { createSession } from '@novasamatech/statement-store';
import type { StorageAdapter } from '@novasamatech/storage-adapter';
import { fieldListView } from '@novasamatech/storage-adapter';
import { nanoid } from 'nanoid';
import type { Result } from 'neverthrow';
import { ResultAsync, err, ok, okAsync } from 'neverthrow';
import { AccountId } from 'polkadot-api';
import type { CodecType } from 'scale-ts';

import { createAsyncTaskPool } from '../../helpers/createAsyncTaskPool.js';
import { toError } from '../../helpers/utils.js';
import type { Callback } from '../../types.js';
import type { StoredUserSession } from '../userSessionRepository.js';

import type { RemoteMessage } from './scale/remoteMessage.js';
import { RemoteMessageCodec } from './scale/remoteMessage.js';
import type { SigningPayloadRequest, SigningRawRequest } from './scale/signingRequest.js';
import type { SigningPayloadResponseData } from './scale/signingResponse.js';

// Timeout for the inner queue task. Without it the queue wedges forever when
// the remote signer doesn't respond — e.g. the request
// payload is for an SDK version the mobile app doesn't support yet. After
// this timeout the queue task fails, freeing the pool for the next request.
const QUEUE_TASK_TIMEOUT_MS = 180_000;

function withQueueTimeout<T>(resultAsync: ResultAsync<T, Error>, label: string): ResultAsync<T, Error> {
  const timeoutPromise = new Promise<Result<T, Error>>(resolve =>
    setTimeout(() => {
      console.warn(`[host-papp][${label}] inner queue task TIMED OUT after ${QUEUE_TASK_TIMEOUT_MS}ms — freeing pool`);
      resolve(err(new Error(`${label} timed out — queue freed`)));
    }, QUEUE_TASK_TIMEOUT_MS),
  );
  return ResultAsync.fromPromise(Promise.race([resultAsync, timeoutPromise]), toError).andThen(r => r);
}

// Set of remote-message ids we are currently awaiting a response for. Used to
// classify incoming SignResponse / RingVrfAliasResponse messages in the
// `[sso-incoming]` log: messages whose `respondingTo` matches an id in this
// set are "relevant" (we have a pending wait), everything else is "stale"
// (typically a leftover from a previous session, since bulletin paseo retains
// statements for ~7 days). On a fresh session start we end up receiving every
// stale response from prior runs in one go; this set lets us bulk-count them
// instead of dumping a wall of detail per message.
const pendingExpectedMessageIds = new Set<string>();

type ProcessedMessage =
  | {
      processed: true;
      message: CodecType<typeof RemoteMessageCodec>;
    }
  | {
      processed: false;
    };

export type UserSession = StoredUserSession & {
  sendDisconnectMessage(): ResultAsync<void, Error>;
  signPayload(payload: SigningPayloadRequest): ResultAsync<SigningPayloadResponseData, Error>;
  signRaw(payload: SigningRawRequest): ResultAsync<SigningPayloadResponseData, Error>;
  getRingVrfAlias(
    productAccountId: CodecType<typeof ProductAccountId>,
    productId: string,
  ): ResultAsync<CodecType<typeof ContextualAlias>, Error>;
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
  const accountId = AccountId();

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

  function toAccountId(address: string) {
    // already an account id
    if (address.startsWith('0x') && address.length === 64 + 2) {
      return address as HexString;
    }

    return toHex(accountId.enc(address));
  }

  function toAddress(account: HexString) {
    return accountId.dec(account);
  }

  return {
    id: userSession.id,
    localAccount: userSession.localAccount,
    remoteAccount: userSession.remoteAccount,

    signPayload(payload) {
      console.info('[host-papp][signPayload] queueing in requestQueue');
      return requestQueue.call(() => {
        const messageId = nanoid();
        pendingExpectedMessageIds.add(messageId);
        console.info(`[host-papp][signPayload] task RUNNING — messageId=${messageId}`);
        const request = session.request(RemoteMessageCodec, {
          messageId,
          data: enumValue(
            'v1',
            enumValue(
              'SignRequest',
              enumValue('Payload', {
                ...payload,
                address: toAddress(toAccountId(payload.address)),
              }),
            ),
          ),
        });

        const responseFilter = (message: RemoteMessage) => {
          if (
            message.data.tag === 'v1' &&
            message.data.value.tag === 'SignResponse' &&
            message.data.value.value.respondingTo === messageId
          ) {
            console.info(
              `[host-papp][signPayload filter] MATCH expected=${messageId.slice(0, 12)} respondingTo=${message.data.value.value.respondingTo.slice(0, 12)}`,
            );
            return message.data.value.value.payload;
          }
        };

        const inner = request
          .andTee(() =>
            console.info(`[host-papp][signPayload] request submitted — waiting for response messageId=${messageId}`),
          )
          .andThen(() => session.waitForRequestMessage(RemoteMessageCodec, responseFilter))
          .andTee(() => console.info(`[host-papp][signPayload] response RECEIVED — messageId=${messageId}`))
          .andThen(message => {
            if (message.success) {
              return ok(message.value);
            } else {
              return err(new Error(message.value));
            }
          });

        const cleanup = () => pendingExpectedMessageIds.delete(messageId);
        return withQueueTimeout(inner, 'signPayload').andTee(cleanup).orTee(cleanup);
      });
    },

    signRaw(payload) {
      console.info('[host-papp][signRaw] queueing in requestQueue');
      return requestQueue.call(() => {
        const messageId = nanoid();
        pendingExpectedMessageIds.add(messageId);
        console.info(`[host-papp][signRaw] task RUNNING — messageId=${messageId}`);
        const request = session.request(RemoteMessageCodec, {
          messageId,
          data: enumValue(
            'v1',
            enumValue(
              'SignRequest',
              enumValue('Raw', {
                ...payload,
                address: toAddress(toAccountId(payload.address)),
              }),
            ),
          ),
        });

        const responseFilter = (message: RemoteMessage) => {
          if (
            message.data.tag === 'v1' &&
            message.data.value.tag === 'SignResponse' &&
            message.data.value.value.respondingTo === messageId
          ) {
            console.info(
              `[host-papp][signRaw filter] MATCH expected=${messageId.slice(0, 12)} respondingTo=${message.data.value.value.respondingTo.slice(0, 12)}`,
            );
            return message.data.value.value.payload;
          }
        };

        const inner = request
          .andTee(() =>
            console.info(`[host-papp][signRaw] request submitted — waiting for response messageId=${messageId}`),
          )
          .andThen(() => session.waitForRequestMessage(RemoteMessageCodec, responseFilter))
          .andTee(() => console.info(`[host-papp][signRaw] response RECEIVED — messageId=${messageId}`))
          .andThen(message => {
            if (message.success) {
              return ok(message.value);
            } else {
              return err(new Error(message.value));
            }
          });

        const cleanup = () => pendingExpectedMessageIds.delete(messageId);
        return withQueueTimeout(inner, 'signRaw').andTee(cleanup).orTee(cleanup);
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
      console.info('[host-papp][getRingVrfAlias] queueing in requestQueue');
      return requestQueue.call(() => {
        const messageId = nanoid();
        pendingExpectedMessageIds.add(messageId);
        console.info(`[host-papp][getRingVrfAlias] task RUNNING — messageId=${messageId}`);
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
            console.info(
              `[host-papp][getRingVrfAlias filter] MATCH expected=${messageId.slice(0, 12)} respondingTo=${message.data.value.value.respondingTo.slice(0, 12)}`,
            );
            return message.data.value.value.payload;
          }
        };

        const inner = request
          .andTee(() =>
            console.info(
              `[host-papp][getRingVrfAlias] request submitted — waiting for response messageId=${messageId}`,
            ),
          )
          .andThen(() => session.waitForRequestMessage(RemoteMessageCodec, responseFilter))
          .andTee(() => console.info(`[host-papp][getRingVrfAlias] response RECEIVED — messageId=${messageId}`))
          .andThen(result => (result.success ? ok(result.value) : err(new Error(result.value))));

        const cleanup = () => pendingExpectedMessageIds.delete(messageId);
        return inner.andTee(cleanup).orTee(cleanup);
      });
    },

    subscribe(callback: Callback<CodecType<typeof RemoteMessageCodec>, ResultAsync<boolean, Error>>) {
      return session.subscribe(RemoteMessageCodec, messages => {
        let stale = 0;
        const relevant: typeof messages = [];
        for (const m of messages) {
          // Stale = a SignResponse / RingVrfAliasResponse for a request we are no
          // longer waiting on (typically left over on the bulletin chain from
          // earlier sessions). Bulk-count them; only print details for messages
          // we actively care about.
          const respondingTo =
            m?.type === 'request' && m.payload.status === 'parsed'
              ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ((m.payload.value.data.value as any)?.value?.respondingTo as string | undefined)
              : undefined;
          if (respondingTo && !pendingExpectedMessageIds.has(respondingTo)) {
            stale++;
          } else {
            relevant.push(m);
          }
        }
        console.info(
          `[sso-incoming] sess=${userSession.id?.slice?.(0, 8) ?? '?'} got ${messages.length} message(s) — ${relevant.length} relevant, ${stale} stale (pending=${pendingExpectedMessageIds.size})`,
        );
        for (const m of relevant) {
          if (m.type !== 'request') {
            console.info(`[sso-incoming]   type=${m.type}`);
            continue;
          }
          const status = m.payload.status;
          const messageId = status === 'parsed' ? m.payload.value.messageId : undefined;
          const dataTag = status === 'parsed' ? m.payload.value.data.tag : undefined;
          const subTag =
            status === 'parsed'
              ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ((m.payload.value.data.value as any)?.tag as string | undefined)
              : undefined;
          const respondingTo =
            status === 'parsed'
              ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ((m.payload.value.data.value as any)?.value?.respondingTo as string | undefined)
              : undefined;
          console.info(
            `[sso-incoming]   type=request status=${status} msgId=${messageId?.slice?.(0, 12) ?? '-'} tag=${dataTag}/${subTag} respondingTo=${respondingTo?.slice?.(0, 12) ?? '-'}`,
          );
        }
        processedMessages.read().andThen(processed => {
          const results = messages.map<ResultAsync<ProcessedMessage, Error>>(message => {
            if (message.type === 'request' && message.payload.status === 'parsed') {
              const payload = message.payload;

              const isMessageProcessed = processed.includes(payload.value.messageId);
              if (isMessageProcessed) {
                return okAsync({ processed: false });
              }

              return callback(payload.value)
                .orTee(error => {
                  console.error('Error while processing sso message:', error);
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
        });
      });
    },

    dispose() {
      return session.dispose();
    },
  };
}
