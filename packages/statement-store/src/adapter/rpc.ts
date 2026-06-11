import { toHex } from '@novasamatech/scale';
import type { Statement, TopicFilter as SdkTopicFilter } from '@novasamatech/sdk-statement';
import { createStatementSdk } from '@novasamatech/sdk-statement';
import { errAsync, fromPromise, okAsync } from 'neverthrow';

import { toError } from '../helpers.js';

import type { LazyClient } from './lazyClient.js';
import type { StatementStoreAdapter, StatementsPage, TopicFilter } from './types.js';
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

function toSdkTopicFilter(filter: TopicFilter): SdkTopicFilter {
  if ('matchAll' in filter) {
    return { matchAll: filter.matchAll.map(toHex) };
  }
  return { matchAny: filter.matchAny.map(toHex) };
}

function createKey(filter: TopicFilter): string {
  if ('matchAll' in filter) {
    return `matchAll:${filter.matchAll.map(toHex).sort().join(',')}`;
  }
  return `matchAny:${filter.matchAny.map(toHex).sort().join(',')}`;
}

export function createPapiStatementStoreAdapter(lazyClient: LazyClient): StatementStoreAdapter {
  type StatementsCallback = (page: StatementsPage) => unknown;

  const sdk = createStatementSdk(lazyClient.getRequestFn(), lazyClient.getSubscribeFn());

  const activeSubscriptions = new Map<string, VoidFunction>();
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
    const list = callbacks.get(key);
    if (!list) return [];
    const idx = list.indexOf(callback);
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) callbacks.delete(key);
    return list;
  }

  const adapter: StatementStoreAdapter = {
    queryStatements(filter) {
      return fromPromise(sdk.getStatements(toSdkTopicFilter(filter)), toError);
    },

    subscribeStatements(filter, callback) {
      const key = createKey(filter);
      const list = addCallback(key, callback);

      if (list.length === 1) {
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
              fn({ statements, isComplete: true });
            }
          }
        };

        const unsub = sdk.subscribeStatements(
          toSdkTopicFilter(filter),
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

      return () => {
        const remaining = removeCallback(key, callback);

        if (remaining.length === 0) {
          const unsub = activeSubscriptions.get(key);
          unsub?.();
          activeSubscriptions.delete(key);
        }
      };
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
                return errAsync(new ExpiryTooLowError(BigInt(result.submitted_expiry), BigInt(result.min_expiry)));
              case 'accountFull':
                return errAsync(new AccountFullError(BigInt(result.submitted_expiry), BigInt(result.min_expiry)));
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
