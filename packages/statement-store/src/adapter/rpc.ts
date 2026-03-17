import type { Statement, TopicFilter } from '@novasamatech/sdk-statement';
import { createStatementSdk } from '@novasamatech/sdk-statement';
import { toHex } from '@polkadot-api/utils';
import { errAsync, fromPromise, okAsync } from 'neverthrow';

import { toError } from '../helpers.js';

import type { LazyClient } from './lazyClient.js';
import type { StatementStoreAdapter } from './types.js';
import {
  AccountFullError,
  AlreadyExpiredError,
  BadProofError,
  DataTooLargeError,
  EncodingTooLargeError,
  ExpiryTooLowError,
  InternalStoreError,
  KnownExpiredError,
  NoAllowanceError,
  NoProofError,
  StorageFullError,
} from './types.js';

function createKey(topics: Uint8Array[]): string {
  return topics.map(toHex).sort().join('');
}

function toTopicFilter(topics: Uint8Array[]): TopicFilter {
  if (topics.length === 0) return 'any';
  return { matchAll: topics.map(t => toHex(t) as `0x${string}`) };
}

export function createPapiStatementStoreAdapter(lazyClient: LazyClient): StatementStoreAdapter {
  type StatementsCallback = (statements: Statement[]) => unknown;

  const sdk = createStatementSdk(lazyClient.getRequestFn(), lazyClient.getSubscribeFn());

  const activeSubscriptions = new Map<string, VoidFunction>();
  const activeTopics = new Map<string, Uint8Array[]>();
  const callbacks = new Map<string, StatementsCallback[]>();

  function addCallback(key: string, callback: StatementsCallback) {
    let list = callbacks.get(key);
    if (!list) {
      list = [];
      callbacks.set(key, list);
    }
    list.push(callback);
    return list;
  }

  function removeCallback(key: string, callback: StatementsCallback) {
    let list = callbacks.get(key);
    if (!list) return [];
    list = list.filter(x => x !== callback);
    if (list.length === 0) {
      callbacks.delete(key);
    } else {
      callbacks.set(key, list);
    }
    return list;
  }

  function createSubscription(key: string, topics: Uint8Array[]) {
    const filter = toTopicFilter(topics);
    let batch: Statement[] = [];
    let flushScheduled = false;

    const flush = () => {
      flushScheduled = false;
      if (batch.length === 0) return;
      const statements = batch;
      batch = [];
      const currentCallbacks = callbacks.get(key);
      if (currentCallbacks) {
        for (const fn of currentCallbacks) {
          fn(statements);
        }
      }
    };

    const unsub = sdk.subscribeStatements(
      filter,
      statement => {
        batch.push(statement);
        if (!flushScheduled) {
          flushScheduled = true;
          setTimeout(flush, 0);
        }
      },
      error => {
        console.error('Statement subscription error:', error);
      },
    );

    activeSubscriptions.set(key, unsub);
  }

  const adapter: StatementStoreAdapter = {
    queryStatements(topics) {
      const filter = toTopicFilter(topics);
      return fromPromise(sdk.getStatements(filter), toError);
    },

    subscribeStatements(topics, callback) {
      const key = createKey(topics);
      const list = addCallback(key, callback);
      activeTopics.set(key, topics);

      if (list.length === 1) {
        createSubscription(key, topics);
      }

      return () => {
        const remaining = removeCallback(key, callback);

        if (remaining.length === 0) {
          const unsub = activeSubscriptions.get(key);
          unsub?.();
          activeSubscriptions.delete(key);
          activeTopics.delete(key);
        }
      };
    },

    reconnect() {
      for (const unsub of activeSubscriptions.values()) {
        unsub();
      }
      activeSubscriptions.clear();

      for (const [key, topics] of activeTopics) {
        if (!callbacks.has(key)) {
          activeTopics.delete(key);
          continue;
        }
        createSubscription(key, topics);
      }
    },

    submitStatement(statement) {
      return fromPromise(sdk.submit(statement), toError).andThen(result => {
        switch (result.status) {
          case 'new':
          case 'known':
            return okAsync(undefined);
          case 'knownExpired':
            return errAsync(new KnownExpiredError());
          case 'internalError':
            return errAsync(new InternalStoreError(result.error));
          case 'rejected':
            switch (result.reason) {
              case 'dataTooLarge':
                return errAsync(new DataTooLargeError(result.submitted_size, result.available_size));
              case 'channelPriorityTooLow':
                return errAsync(new ExpiryTooLowError(result.submitted_expiry, result.min_expiry));
              case 'accountFull':
                return errAsync(new AccountFullError(result.submitted_expiry, result.min_expiry));
              case 'storeFull':
                return errAsync(new StorageFullError());
              case 'noAllowance':
                return errAsync(new NoAllowanceError());
              default:
                return errAsync(new Error('Unknown rejection reason'));
            }
          case 'invalid':
            switch (result.reason) {
              case 'noProof':
                return errAsync(new NoProofError());
              case 'badProof':
                return errAsync(new BadProofError());
              case 'encodingTooLarge':
                return errAsync(new EncodingTooLargeError(result.submitted_size, result.max_size));
              case 'alreadyExpired':
                return errAsync(new AlreadyExpiredError());
              default:
                return errAsync(new Error('Unknown rejection reason: invalid'));
            }
          default:
            return okAsync(undefined);
        }
      });
    },
  };

  return adapter;
}
