import { ContextualAlias, ProductAccountId } from '@novasamatech/host-api';
import type { HexString } from '@novasamatech/scale';
import { enumValue, toHex } from '@novasamatech/scale';
import type { Encryption, StatementProver, StatementStoreAdapter } from '@novasamatech/statement-store';
import { createSession } from '@novasamatech/statement-store';
import type { StorageAdapter } from '@novasamatech/storage-adapter';
import { fieldListView } from '@novasamatech/storage-adapter';
import { AccountId } from '@polkadot-api/substrate-bindings';
import { nanoid } from 'nanoid';
import { ResultAsync, err, errAsync, ok, okAsync } from 'neverthrow';
import type { CodecType } from 'scale-ts';

import { emitHostPappDebugMessage } from '../../debugBus.js';
import type { Callback } from '../../types.js';
import type { StoredUserSession } from '../userSessionRepository.js';

import type { RemoteMessage } from './scale/remoteMessage.js';
import { RemoteMessageCodec } from './scale/remoteMessage.js';
import type { SigningPayloadRequest, SigningRawRequest } from './scale/signingRequest.js';
import type { SigningPayloadResponseData } from './scale/signingResponse.js';

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
    // already account id
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
      const accountId = toAccountId(payload.address);
      if (accountId !== toHex(userSession.remoteAccount.accountId)) {
        return errAsync(new Error(`Invalid address, got ${payload.address}`));
      }

      const messageId = nanoid();
      emitHostActionSent(userSession.id, 'SignPayload', messageId);
      const request = session.request(RemoteMessageCodec, {
        messageId,
        data: enumValue(
          'v1',
          enumValue(
            'SignRequest',
            enumValue('Payload', {
              ...payload,
              address: toAddress(accountId),
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
          return message.data.value.value.payload;
        }
      };

      return request
        .andThen(() => session.waitForRequestMessage(RemoteMessageCodec, responseFilter))
        .andThen(message => {
          if (message.success) {
            emitHostActionResponseReceived(userSession.id, messageId, true);
            return ok(message.value);
          } else {
            emitHostActionResponseReceived(userSession.id, messageId, false);
            return err(new Error(message.value));
          }
        })
        .orTee(e => emitHostActionFailed(userSession.id, messageId, e.message));
    },

    signRaw(payload) {
      const accountId = toAccountId(payload.address);
      if (accountId !== toHex(userSession.remoteAccount.accountId)) {
        return errAsync(new Error(`Invalid address, got ${payload.address}`));
      }

      const messageId = nanoid();
      emitHostActionSent(userSession.id, 'SignRaw', messageId);
      const request = session.request(RemoteMessageCodec, {
        messageId,
        data: enumValue(
          'v1',
          enumValue(
            'SignRequest',
            enumValue('Raw', {
              ...payload,
              address: toAddress(accountId),
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
          return message.data.value.value.payload;
        }
      };

      return request
        .andThen(() => session.waitForRequestMessage(RemoteMessageCodec, responseFilter))
        .andThen(message => {
          if (message.success) {
            emitHostActionResponseReceived(userSession.id, messageId, true);
            return ok(message.value);
          } else {
            emitHostActionResponseReceived(userSession.id, messageId, false);
            return err(new Error(message.value));
          }
        })
        .orTee(e => emitHostActionFailed(userSession.id, messageId, e.message));
    },

    sendDisconnectMessage() {
      const messageId = nanoid();
      emitHostActionSent(userSession.id, 'Disconnect', messageId);
      return session
        .submitRequestMessage(RemoteMessageCodec, {
          messageId,
          data: enumValue('v1', enumValue('Disconnected', undefined)),
        })
        .map(() => undefined)
        .andTee(() => emitHostActionResponseReceived(userSession.id, messageId, true))
        .orTee(e => emitHostActionFailed(userSession.id, messageId, e.message));
    },

    subscribe(callback: Callback<CodecType<typeof RemoteMessageCodec>, ResultAsync<boolean, Error>>) {
      return session.subscribe(RemoteMessageCodec, messages => {
        processedMessages.read().andThen(processed => {
          const results = messages.map<ResultAsync<ProcessedMessage, Error>>(message => {
            if (message.type === 'request' && message.payload.status === 'parsed') {
              const payload = message.payload;

              const isMessageProcessed = processed.includes(payload.value.messageId);
              if (isMessageProcessed) {
                return okAsync({ processed: false });
              }

              const peerMessageId = payload.value.messageId;
              emitHostPappDebugMessage({
                layer: 'session',
                event: 'peer_action_received',
                flowId: peerMessageId,
                timestamp: Date.now(),
                payload: {
                  sessionId: userSession.id,
                  actionKind: describePeerAction(payload.value.data),
                  messageId: peerMessageId,
                },
              });

              return callback(payload.value)
                .orTee(error => {
                  console.error('Error while processing sso message:', error);
                  emitHostPappDebugMessage({
                    layer: 'session',
                    event: 'peer_action_failed',
                    flowId: peerMessageId,
                    timestamp: Date.now(),
                    payload: {
                      sessionId: userSession.id,
                      messageId: peerMessageId,
                      reason: error.message,
                    },
                  });
                })
                .orElse(() => okAsync(false))
                .andTee(processed =>
                  emitHostPappDebugMessage({
                    layer: 'session',
                    event: 'peer_action_processed',
                    flowId: peerMessageId,
                    timestamp: Date.now(),
                    payload: {
                      sessionId: userSession.id,
                      messageId: peerMessageId,
                      processed,
                    },
                  }),
                )
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

    getRingVrfAlias(productAccountId, productId) {
      const messageId = nanoid();
      emitHostActionSent(userSession.id, 'RingVrfAliasRequest', messageId);
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

      return request
        .andThen(() => session.waitForRequestMessage(RemoteMessageCodec, responseFilter))
        .andThen(result => {
          if (result.success) {
            emitHostActionResponseReceived(userSession.id, messageId, true);
            return ok(result.value);
          }
          emitHostActionResponseReceived(userSession.id, messageId, false);
          return err(new Error(result.value));
        })
        .orTee(e => emitHostActionFailed(userSession.id, messageId, e.message));
    },

    dispose() {
      return session.dispose();
    },
  };
}

function emitHostActionSent(sessionId: string, actionKind: string, messageId: string): void {
  emitHostPappDebugMessage({
    layer: 'session',
    event: 'host_action_sent',
    flowId: messageId,
    timestamp: Date.now(),
    payload: { sessionId, actionKind, messageId },
  });
}

function emitHostActionResponseReceived(sessionId: string, messageId: string, success: boolean): void {
  emitHostPappDebugMessage({
    layer: 'session',
    event: 'host_action_response_received',
    flowId: messageId,
    timestamp: Date.now(),
    payload: { sessionId, messageId, success },
  });
}

function emitHostActionFailed(sessionId: string, messageId: string, reason: string): void {
  emitHostPappDebugMessage({
    layer: 'session',
    event: 'host_action_failed',
    flowId: messageId,
    timestamp: Date.now(),
    payload: { sessionId, messageId, reason },
  });
}

/** Human-readable name for a remote message's inner variant. */
function describePeerAction(data: RemoteMessage['data']): string {
  if (data.tag === 'v1') {
    return data.value.tag;
  }
  return data.tag;
}
