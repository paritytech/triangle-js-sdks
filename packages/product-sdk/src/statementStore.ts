import type {
  CodecType,
  ProductAccountId as ProductAccountIdCodec,
  SignedStatement as SignedStatementCodec,
  Statement as StatementCodec,
  Topic as TopicCodec,
  Transport,
} from '@novasamatech/host-api';
import { createHostApi, enumValue } from '@novasamatech/host-api';

import { sandboxTransport } from './sandboxTransport.js';

export type Statement = CodecType<typeof StatementCodec>;
export type SignedStatement = CodecType<typeof SignedStatementCodec>;

export type Topic = CodecType<typeof TopicCodec>;
export type ProductAccountId = CodecType<typeof ProductAccountIdCodec>;

export type StatementTopicFilter = { matchAll: Topic[] } | { matchAny: Topic[] };

export type StatementsPage = {
  statements: SignedStatement[];
  isComplete: boolean;
};

export const createStatementStore = (transport: Transport = sandboxTransport) => {
  const hostApi = createHostApi(transport);

  return {
    subscribe(filter: StatementTopicFilter, callback: (page: StatementsPage) => void) {
      const scaleFilter =
        'matchAll' in filter ? enumValue('MatchAll', filter.matchAll) : enumValue('MatchAny', filter.matchAny);
      return hostApi.statementStoreSubscribe(enumValue('v1', scaleFilter), payload => {
        if (payload.tag === 'v1') {
          callback(payload.value);
        }
      });
    },

    async createProof(accountId: ProductAccountId, statement: Statement) {
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
