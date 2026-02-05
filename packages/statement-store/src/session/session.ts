import type { Statement } from '@polkadot-api/sdk-statement';
import { Binary } from '@polkadot-api/substrate-bindings';
import { nanoid } from 'nanoid';
import { ResultAsync, err, fromPromise, fromThrowable, ok, okAsync } from 'neverthrow';
import type { Codec } from 'scale-ts';
import { Bytes } from 'scale-ts';

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
};

export function createSession({
  localAccount,
  remoteAccount,
  statementStore,
  encryption,
  prover,
}: SessionParams): Session {
  let subscriptions: VoidFunction[] = [];

  function submit(sessionId: SessionId, channel: Uint8Array, data: Uint8Array) {
    return encryption
      .encrypt(data)
      .map<Statement>(data => ({
        priority: getPriority(now()),
        // @ts-expect-error unmatched types of @polkadot-api/sdk-statement and @polkadot-api/substrate-bindings
        channel: Binary.fromBytes(channel),
        // @ts-expect-error unmatched types of @polkadot-api/sdk-statement and @polkadot-api/substrate-bindings
        topics: [Binary.fromBytes(sessionId)],
        // @ts-expect-error unmatched types of @polkadot-api/sdk-statement and @polkadot-api/substrate-bindings
        data: Binary.fromBytes(data),
      }))
      .asyncAndThen(prover.generateMessageProof)
      .andThen(statementStore.submitStatement);
  }

  const session: Session = {
    request<T>(codec: Codec<T>, data: T) {
      return session.submitRequestMessage(codec, data).andThen(({ requestId }) => {
        return session.waitForResponseMessage(requestId).andThen(({ responseCode }) => mapResponseCode(responseCode));
      });
    },

    submitRequestMessage<T>(codec: Codec<T>, message: T) {
      const requestId = nanoid();
      const sessionId = createSessionId(remoteAccount.publicKey, localAccount, remoteAccount);

      const encode = fromThrowable(StatementData.enc, toError);
      const encoded = codec.enc(message);

      const rawData = encode({
        tag: 'request',
        value: { requestId, data: [encoded] },
      });

      return rawData
        .asyncAndThen(data => submit(sessionId, createRequestChannel(sessionId), data))
        .map(() => ({ requestId }));
    },

    submitResponseMessage(requestId: string, responseCode: ResponseStatus) {
      const sessionId = createSessionId(remoteAccount.publicKey, localAccount, remoteAccount);

      const encode = fromThrowable(StatementData.enc, toError);

      const rawData = encode({
        tag: 'response',
        value: { requestId, responseCode },
      });

      return rawData.asyncAndThen(data => submit(sessionId, createResponseChannel(sessionId), data));
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

    waitForResponseMessage(requestId: string) {
      const promise = new Promise<ResponseMessage>(resolve => {
        const unsub = session.subscribe(Bytes(), messages => {
          const response = messages.filter(m => m.type === 'response').find(m => m.requestId === requestId);
          if (response) {
            unsub();
            resolve(response);
          }
        });
      });

      return fromPromise(promise, toError);
    },

    subscribe<T>(codec: Codec<T>, callback: Callback<Message<T>[]>) {
      const sessionId = createSessionId(remoteAccount.publicKey, remoteAccount, localAccount);

      function processStatement(statement: Statement) {
        if (!statement.data) return okAsync(null);

        const data = statement.data.asBytes();

        return prover
          .verifyMessageProof(statement)
          .andThen(verified => (verified ? ok() : err(new Error('Statement proof is not valid'))))
          .andThen(() => encryption.decrypt(data))
          .map(StatementData.dec)
          .orElse(() => ok(null));
      }

      return statementStore.subscribeStatements([sessionId], statements => {
        ResultAsync.combine(statements.map(processStatement))
          .map(messages => messages.filter(nonNullable).flatMap(x => toMessage(x, codec)))
          .andTee(messages => {
            if (messages.length > 0) {
              callback(messages);
            }
          })
          // TODO rework
          .andTee(messages => {
            const requests = messages.filter(m => m.type === 'request').map(m => m.requestId);
            const responses = requests.map(requestId => session.submitResponseMessage(requestId, 'success'));

            return ResultAsync.combine(responses);
          });
      });
    },

    dispose() {
      for (const unsub of subscriptions) {
        unsub();
      }
      subscriptions = [];
    },
  };

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

function now() {
  const d1 = new Date();
  const d2 = new Date(
    d1.getUTCFullYear(),
    d1.getUTCMonth(),
    d1.getUTCDate(),
    d1.getUTCHours(),
    d1.getUTCMinutes(),
    d1.getUTCSeconds(),
  );
  return d2.getTime();
}

function getPriority(timestamp: number) {
  // time - (November 15, 2025)
  return Math.floor((timestamp - 1763154000000) / 1000);
}

function createRequestChannel(sessionId: Uint8Array) {
  return khash(sessionId, stringToBytes('request'));
}

function createResponseChannel(sessionId: Uint8Array) {
  return khash(sessionId, stringToBytes('response'));
}
