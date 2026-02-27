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
            return ok(message.value);
          } else {
            return err(new Error(message.value));
          }
        });
    },

    signRaw(payload) {
      const accountId = toAccountId(payload.address);
      if (accountId !== toHex(userSession.remoteAccount.accountId)) {
        return errAsync(new Error(`Invalid address, got ${payload.address}`));
      }

      const messageId = nanoid();
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
            return ok(message.value);
          } else {
            return err(new Error(message.value));
          }
        });
    },

    sendDisconnectMessage() {
      return session
        .submitRequestMessage(RemoteMessageCodec, {
          messageId: nanoid(),
          data: enumValue('v1', enumValue('Disconnected', undefined)),
        })
        .map(() => undefined);
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
