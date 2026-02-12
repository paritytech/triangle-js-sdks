import type { Statement } from '@polkadot-api/sdk-statement';
import { createStatementSdk } from '@polkadot-api/sdk-statement';
import { Binary } from '@polkadot-api/substrate-bindings';
import { toHex } from '@polkadot-api/utils';
import type { ResultAsync } from 'neverthrow';
import { errAsync, fromPromise, okAsync } from 'neverthrow';

import { toError } from '../helpers.js';

import type { LazyClient } from './lazyClient.js';
import type { StatementStoreAdapter } from './types.js';
import {
  AccountFullError,
  BadProofError,
  DataTooLargeError,
  EncodingTooLargeError,
  NoProofError,
  PriorityTooLowError,
  StorageFullError,
} from './types.js';

const POLLING_INTERVAL = 1500;

function createKey(topics: Uint8Array[]): string {
  return topics.map(toHex).sort().join('');
}

export function createPapiStatementStoreAdapter(lazyClient: LazyClient): StatementStoreAdapter {
  type StatementsCallback = (statements: Statement[]) => unknown;

  const sdk = createStatementSdk((method, params) => {
    const client = lazyClient.getClient();
    return client._request(method, params);
  });

  const pollings = new Map<string, VoidFunction>();
  const subscriptions = new Map<string, StatementsCallback[]>();

  function addSubscription(key: string, subscription: StatementsCallback) {
    let subs = subscriptions.get(key);
    if (!subs) {
      subs = [];
      subscriptions.set(key, subs);
    }

    subs.push(subscription);
    return subs;
  }

  function removeSubscription(key: string, subscription: StatementsCallback) {
    let subs = subscriptions.get(key);
    if (!subs) {
      return [];
    }

    subs = subs.filter(x => x !== subscription);
    return subs;
  }

  const transportProvider: StatementStoreAdapter = {
    queryStatements(topics, destination) {
      return fromPromise(
        sdk.getStatements({
          // @ts-expect-error unmatched types of @polkadot-api/sdk-statement and @polkadot-api/substrate-bindings
          topics: topics.map(t => Binary.fromBytes(t)),
          // @ts-expect-error unmatched types of @polkadot-api/sdk-statement and @polkadot-api/substrate-bindings
          dest: destination ? Binary.fromBytes(destination) : null,
        }),
        toError,
      );
    },
    subscribeStatements(topics, callback) {
      const key = createKey(topics);
      const callbacks = addSubscription(key, callback);

      if (callbacks.length === 1) {
        const unsub = polling(
          POLLING_INTERVAL,
          () => transportProvider.queryStatements(topics),
          statements => {
            const list = subscriptions.get(key);
            if (list) {
              for (const fn of list) {
                fn(statements);
              }
            }
          },
        );

        pollings.set(key, unsub);
      }

      return () => {
        const callbacks = removeSubscription(key, callback);

        if (callbacks.length === 0) {
          const stopPolling = pollings.get(key);
          stopPolling?.();
          pollings.delete(key);
        }
      };
    },
    submitStatement(statement) {
      return fromPromise(sdk.submit(statement), toError).andThen(result => {
        switch (result.status) {
          case 'new':
          case 'known':
            return okAsync(undefined);
          case 'rejected':
            switch (result.reason) {
              case 'dataTooLarge':
                return errAsync(new DataTooLargeError(result.submitted_size, result.available_size));
              case 'channelPriorityTooLow':
                return errAsync(new PriorityTooLowError(result.submitted_priority, result.min_priority));
              case 'accountFull':
                return errAsync(new AccountFullError());
              case 'storeFull':
                return errAsync(new StorageFullError());
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
              default:
                return errAsync(new Error('Unknown rejection reason: invalid'));
            }
          default:
            return okAsync(undefined);
        }
      });
    },
  };

  return transportProvider;
}

function polling<R>(
  interval: number,
  request: () => ResultAsync<R, Error>,
  callback: (response: R) => void,
): VoidFunction {
  let active = true;
  let tm: NodeJS.Timeout | null = null;
  function createCycle() {
    tm = setTimeout(() => {
      if (!active) {
        return;
      }

      request().match(
        data => {
          callback(data);
          createCycle();
        },
        () => {
          createCycle();
        },
      );
    }, interval);
  }

  createCycle();

  return () => {
    active = false;
    if (tm !== null) {
      clearTimeout(tm);
    }
  };
}
