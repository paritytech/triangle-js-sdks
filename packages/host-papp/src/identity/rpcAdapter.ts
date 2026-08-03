import type { HexString } from '@novasamatech/scale';
import { toHex } from '@novasamatech/scale';
import type { LazyClient } from '@novasamatech/statement-store';
import { Result, errAsync, fromPromise, ok } from 'neverthrow';
import { AccountId } from 'polkadot-api';
import type { Observable } from 'rxjs';
import { defer, map, throwError } from 'rxjs';

import type { People_lite, People_liteQueries } from '../../.papi/descriptors/dist/index.js';
import { toError } from '../helpers/utils.js';
import { zipWith } from '../helpers/zipWith.js';

import { IdentifierKey } from './identifierKey.js';
import type { Credibility, Identity, IdentityAdapter } from './types.js';

// The raw value type is owned by the papi descriptor; derive it from the
// `Resources.Consumers` storage entry rather than restating the shape here.
type RawConsumers = NonNullable<People_liteQueries['Resources']['Consumers']['Value']>;

export function decodeRawIdentity(
  accountId: string,
  raw: RawConsumers | undefined,
  textDecoder: TextDecoder,
): Identity | null {
  if (!raw) return null;

  const credibility: Credibility =
    raw.credibility.type === 'Lite'
      ? { type: 'Lite' }
      : {
          type: 'Person',
          alias: raw.credibility.value.alias as HexString,
          lastUpdate: (raw.credibility.value.last_update as bigint | undefined)?.toString() ?? null,
        };

  return {
    accountId,
    fullUsername: raw.full_username ? textDecoder.decode(raw.full_username) : null,
    liteUsername: textDecoder.decode(raw.lite_username),
    credibility,
    // A keypair type we can't encrypt to is a normal condition, not a fault.
    identifierKey: Result.fromThrowable(IdentifierKey.dec)(raw.identifier_key)
      .map(({ value }) => toHex(value.key))
      .unwrapOr(null),
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
      // `defer` so client resolution and key decoding run on subscribe and any
      // failure surfaces as a stream error, not a synchronous throw at the call
      // site (the consumer only attaches its error handler via `.subscribe`).
      return defer(() => {
        const method = getConsumersStorage();
        if (!method) {
          return throwError(() => new Error('Method Resources.Consumers not found'));
        }
        return method
          .watchValue(accCodec.dec(accountId))
          .pipe(map(emission => decodeRawIdentity(accountId, emission.value, textDecoder)));
      });
    },
  };
}
