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
            zipWith([accounts, results], x => x).map<[string, Identity | null]>(([accountId, typedRaw]) => {
              if (!typedRaw) {
                return [accountId, null];
              }

              // Runtime metadata may expose fields in snake_case (V1) or
              // camelCase (V2 multi-device). Read defensively. The .papi
              // descriptor only types snake_case, so widen here.
              const raw = typedRaw as unknown as Record<string, unknown> & typeof typedRaw;
              const fullUsername =
                (raw.full_username as Uint8Array | undefined) ?? (raw.fullUsername as Uint8Array | undefined);
              const liteUsername =
                (raw.lite_username as Uint8Array | undefined) ?? (raw.liteUsername as Uint8Array | undefined);

              const credibility: Credibility =
                raw.credibility.type == 'Lite'
                  ? {
                      type: 'Lite',
                    }
                  : {
                      type: 'Person',
                      alias: raw.credibility.value.alias as HexString,
                      lastUpdate: ((raw.credibility.value as Record<string, unknown>).last_update ??
                        (raw.credibility.value as Record<string, unknown>).lastUpdate)!.toString(),
                    };

              return [
                accountId,
                {
                  accountId: accountId,
                  fullUsername: fullUsername ? textDecoder.decode(fullUsername) : null,
                  liteUsername: liteUsername ? textDecoder.decode(liteUsername) : '',
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
