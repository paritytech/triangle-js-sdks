import type { HexString } from '@novasamatech/scale';
import type { LazyClient } from '@novasamatech/statement-store';
import { errAsync, fromPromise, ok } from 'neverthrow';
import { AccountId } from 'polkadot-api';

import type { People_lite } from '../../.papi/descriptors/dist/index.js';
import { toError } from '../helpers/utils.js';
import { zipWith } from '../helpers/zipWith.js';

import type { Credibility, Identity, IdentityAdapter } from './types.js';

export function createIdentityRpcAdapter(lazyClient: LazyClient): IdentityAdapter {
  const accCodec = AccountId();

  return {
    readIdentities(accounts) {
      const textDecoder = new TextDecoder();
      const client = lazyClient.getClient();
      const unsafeApi = client.getUnsafeApi<People_lite>();

      const method = unsafeApi.query.Resources.Consumers;

      if (!method) {
        return errAsync(new Error('Method Resources.Consumers not found'));
      }

      const results = fromPromise(method.getValues(accounts.map(x => [accCodec.dec(x)])), toError);

      return results.andThen(results => {
        if (!results) {
          return ok({});
        }

        return ok(
          Object.fromEntries(
            zipWith([accounts, results], x => x).map<[string, Identity | null]>(([accountId, raw]) => {
              if (!raw) {
                return [accountId, null];
              }

              const credibility: Credibility =
                raw.credibility.type == 'Lite'
                  ? {
                      type: 'Lite',
                    }
                  : {
                      type: 'Person',
                      alias: raw.credibility.value.alias as HexString,
                      lastUpdate: raw.credibility.value.last_update.toString(),
                    };

              return [
                accountId,
                {
                  accountId: accountId,
                  fullUsername: raw.full_username ? textDecoder.decode(raw.full_username) : null,
                  liteUsername: textDecoder.decode(raw.lite_username),
                  credibility,
                },
              ];
            }),
          ),
        );
      });
    },
  };
}
