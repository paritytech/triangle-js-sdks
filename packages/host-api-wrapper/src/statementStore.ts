import type {
  AccountSelector,
  CodecType,
  ProductAccountId as ProductAccountIdCodec,
  SignedStatement as SignedStatementCodec,
  Statement as StatementCodec,
  Subscription,
  Topic as TopicCodec,
  Transport,
} from '@novasamatech/host-api';
import { createHostApi, derivationIndexOf, enumValue } from '@novasamatech/host-api';

import { sandboxTransport } from './sandboxTransport.js';

export type Statement = CodecType<typeof StatementCodec>;
export type SignedStatement = CodecType<typeof SignedStatementCodec>;

export type Topic = CodecType<typeof TopicCodec>;
/** Wire-level product account id — the selector in its `Index`/`Raw` form. */
export type ProductAccountId = CodecType<typeof ProductAccountIdCodec>;

/**
 * Product account reference in ergonomic form: the dotNS identifier plus a
 * plain index or a raw 32-byte index (RFC 0022).
 */
export type ProductAccountRef = [dotNsIdentifier: string, derivationIndex: AccountSelector];

export type StatementTopicFilter = { matchAll: Topic[] } | { matchAny: Topic[] };

export type StatementsPage = {
  statements: SignedStatement[];
  isComplete: boolean;
};

export const createStatementStore = (transport: Transport = sandboxTransport) => {
  const hostApi = createHostApi(transport);

  return {
    subscribe(filter: StatementTopicFilter, callback: (page: StatementsPage) => void): Subscription<void> {
      const scaleFilter =
        'matchAll' in filter ? enumValue('MatchAll', filter.matchAll) : enumValue('MatchAny', filter.matchAny);
      const subscriber = hostApi.statementStoreSubscribe(enumValue('v1', scaleFilter), payload => {
        if (payload.tag === 'v1') {
          callback(payload.value);
        }
      });

      return {
        unsubscribe: subscriber.unsubscribe,
        onInterrupt: cb => subscriber.onInterrupt(v => cb(v.value)),
      };
    },

    async createProof([dotNsIdentifier, derivationIndex]: ProductAccountRef, statement: Statement) {
      const accountId: ProductAccountId = [dotNsIdentifier, derivationIndexOf(derivationIndex)];
      const result = await hostApi.statementStoreCreateProof(enumValue('v1', [accountId, statement]));

      return result.match(
        payload => {
          if (payload.tag === 'v1') {
            return payload.value;
          }
          throw new Error(`Unknown response version ${payload.tag}`);
        },
        err => {
          throw err.value;
        },
      );
    },

    async submit(signedStatement: SignedStatement): Promise<void> {
      const result = await hostApi.statementStoreSubmit(enumValue('v1', signedStatement));

      return result.match(
        payload => {
          if (payload.tag === 'v1') {
            return;
          }
          throw new Error(`Unknown response version ${payload.tag}`);
        },
        err => {
          throw err.value;
        },
      );
    },
  };
};
