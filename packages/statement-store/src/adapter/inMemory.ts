import type { SignedStatement, Statement } from '@novasamatech/sdk-statement';
import { errAsync, okAsync } from 'neverthrow';
import { toHex } from 'polkadot-api/utils';

import type { StatementStoreAdapter, StatementsPage, TopicFilter } from './types.js';
import { ExpiryTooLowError } from './types.js';

/**
 * An in-memory {@link StatementStoreAdapter} that replicates the real statement
 * store's observable contract, for tests and local development.
 *
 * Fidelity rules (mirroring the on-chain store):
 *   - One statement per channel. A same-channel write is accepted only with a
 *     STRICTLY HIGHER expiry; an equal-or-lower expiry is rejected with
 *     {@link ExpiryTooLowError} (the store's `channelPriorityTooLow`). A
 *     byte-identical resubmission is "known" → ok, with no duplicate.
 *   - `queryStatements` returns the current per-channel statements matching the
 *     topic filter (superseded statements are evicted).
 *   - `subscribeStatements` streams statements submitted AFTER subscription that
 *     match the filter — the initial snapshot is obtained via `queryStatements`,
 *     exactly as a consumer does. Delivery is synchronous on submit.
 *
 * Two mirrored sessions can share ONE store to exercise full bidirectional
 * host ↔ peer flows: a submit by one is observed by the other.
 *
 * It IS a {@link StatementStoreAdapter} (pass it straight to `createSession`)
 * with extra inspection helpers attached.
 */
export type InMemoryStatementStore = StatementStoreAdapter & {
  /** Statements currently retained — one per channel (highest expiry wins). */
  currentStatements(): Statement[];
  /** Every accepted submission, in order (excludes rejected writes and known no-ops). */
  acceptedStatements(): Statement[];
  /** Number of live subscriptions (increases on subscribe, decreases on unsubscribe). */
  activeSubscriptions(): number;
};

export function createInMemoryStatementStore(): InMemoryStatementStore {
  const channels = new Map<string, Statement>();
  const accepted: Statement[] = [];
  const subscribers = new Set<{ filter: TopicFilter; callback: (page: StatementsPage) => unknown }>();

  const topicsOf = (s: Statement) => s.topics ?? [];
  const matches = (filter: TopicFilter, s: Statement): boolean => {
    const topics = topicsOf(s);
    return 'matchAll' in filter
      ? filter.matchAll.every(t => topics.includes(toHex(t) as `0x${string}`))
      : filter.matchAny.some(t => topics.includes(toHex(t) as `0x${string}`));
  };
  // Statement identity for the "known" (dedup) check.
  const keyOf = (s: Statement) =>
    `${s.channel ?? ''}|${(s.expiry ?? 0n).toString()}|${topicsOf(s).join(',')}|${s.data ? toHex(s.data) : ''}`;

  const adapter: StatementStoreAdapter = {
    queryStatements(filter) {
      return okAsync([...channels.values()].filter(s => matches(filter, s)));
    },
    subscribeStatements(filter, callback) {
      const sub = { filter, callback };
      subscribers.add(sub);
      return () => {
        subscribers.delete(sub);
      };
    },
    submitStatement(statement: SignedStatement) {
      const channel = statement.channel ?? '';
      const existing = channels.get(channel);
      const submittedExpiry = statement.expiry ?? 0n;

      if (existing) {
        if (keyOf(existing) === keyOf(statement)) return okAsync(undefined); // known
        const existingExpiry = existing.expiry ?? 0n;
        if (submittedExpiry <= existingExpiry) {
          return errAsync(new ExpiryTooLowError(submittedExpiry, existingExpiry));
        }
      }

      channels.set(channel, statement);
      accepted.push(statement);
      for (const sub of subscribers) {
        if (matches(sub.filter, statement)) {
          sub.callback({ statements: [statement], isComplete: true });
        }
      }
      return okAsync(undefined);
    },
  };

  return {
    ...adapter,
    currentStatements: () => [...channels.values()],
    acceptedStatements: () => [...accepted],
    activeSubscriptions: () => subscribers.size,
  };
}
