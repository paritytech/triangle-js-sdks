import type { HexString } from '@novasamatech/scale';
import type { LazyClient } from '@novasamatech/statement-store';
import { errAsync, fromPromise, ok } from 'neverthrow';
import { AccountId } from 'polkadot-api';
import type { Observable } from 'rxjs';
import { map, throwError } from 'rxjs';

import type { People_lite } from '../../.papi/descriptors/dist/index.js';
import { toError } from '../helpers/utils.js';
import { zipWith } from '../helpers/zipWith.js';

import type { Credibility, Identity, IdentityAdapter } from './types.js';

type RawConsumers = {
  full_username?: Uint8Array;
  fullUsername?: Uint8Array;
  lite_username?: Uint8Array;
  liteUsername?: Uint8Array;
  credibility:
    | { type: 'Lite' }
    | {
        type: 'Person';
        value: {
          alias: unknown;
          last_update?: unknown;
          lastUpdate?: unknown;
        };
      };
};

function decodeRawIdentity(accountId: string, typedRaw: unknown, textDecoder: TextDecoder): Identity | null {
  if (!typedRaw) return null;

  // Runtime metadata may expose fields in snake_case (V1) or camelCase (V2
  // multi-device). The .papi descriptor only types snake_case, so widen here
  // and read defensively.
  const raw = typedRaw as RawConsumers;
  const fullUsername = raw.full_username ?? raw.fullUsername;
  const liteUsername = raw.lite_username ?? raw.liteUsername;

  const credibility: Credibility =
    raw.credibility.type === 'Lite'
      ? { type: 'Lite' }
      : {
          type: 'Person',
          alias: raw.credibility.value.alias as HexString,
          lastUpdate: (raw.credibility.value.last_update ?? raw.credibility.value.lastUpdate)!.toString(),
        };

  return {
    accountId,
    fullUsername: fullUsername ? textDecoder.decode(fullUsername) : null,
    liteUsername: liteUsername ? textDecoder.decode(liteUsername) : '',
    credibility,
  };
}

export function createIdentityRpcAdapter(lazyClient: LazyClient): IdentityAdapter {
  const accCodec = AccountId();
  const textDecoder = new TextDecoder();

  function getConsumersStorage() {
    const client = lazyClient.getClient();
    const unsafeApi = client.getUnsafeApi<People_lite>();
    return unsafeApi.query.Resources.Consumers;
  }

  return {
    readIdentities(accounts) {
      const method = getConsumersStorage();
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
            zipWith([accounts, results], x => x).map<[string, Identity | null]>(([accountId, typedRaw]) => [
              accountId,
              decodeRawIdentity(accountId, typedRaw, textDecoder),
            ]),
          ),
        );
      });
    },

    watchIdentity(accountId): Observable<Identity | null> {
      const method = getConsumersStorage();
      if (!method) {
        return throwError(() => new Error('Method Resources.Consumers not found'));
      }
      return method
        .watchValue(accCodec.dec(accountId))
        .pipe(map(emission => decodeRawIdentity(accountId, emission.value, textDecoder)));
    },
  };
}
