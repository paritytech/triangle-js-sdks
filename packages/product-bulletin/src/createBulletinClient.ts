import type { HexString } from '@novasamatech/host-api';
import { createPapiProvider } from '@novasamatech/host-api-wrapper';
import type { BulletinTypedApi, ClientConfig } from '@parity/bulletin-sdk';
import { AsyncBulletinClient } from '@parity/bulletin-sdk';
import type { PolkadotSigner } from 'polkadot-api';
import { createClient } from 'polkadot-api';

import type { RenewArgs } from './constants.js';
import { BulletinChain } from './constants.js';

/** Union of known Bulletin Chain descriptor types, derived from {@link BulletinChain}. */
export type BulletinDescriptor = (typeof BulletinChain)[keyof typeof BulletinChain]['descriptor'];

export interface CreateBulletinClientOptions {
  /** Bulletin Chain genesis hash — see {@link BulletinChain} for known networks */
  genesisHash: HexString;
  /** PAPI chain descriptor for the target network */
  descriptor: BulletinDescriptor;
  /** PAPI signer for transaction submission */
  signer: PolkadotSigner;
  /** Optional AsyncBulletinClient config (chunk size, manifest behavior) */
  config?: Partial<ClientConfig>;
  /**
   * `TransactionStorage.renew` ABI of the target runtime. Defaults to the entry in
   * {@link BulletinChain} matching `genesisHash`. **Required** when `genesisHash` names a
   * chain that isn't listed — guessing it wrong produces no type or client-side error,
   * only an extrinsic the chain rejects, so `createBulletinClient` throws instead.
   */
  renewArgs?: RenewArgs;
}

/**
 * `@parity/bulletin-sdk` 0.3.0 (the newest published) calls
 * `TransactionStorage.renew({ block, index })`. Runtimes that moved to
 * `renew({ entry })` — an enum selecting `Position { block, index }` or `ContentHash` —
 * reject that payload, so rewrite the argument on the way through. Every other call in
 * `BulletinTypedApi` is byte-identical across all four chains in {@link BulletinChain};
 * `renew` is the only one that moved.
 *
 * ponytail: a Proxy over the one changed method, rather than restating the other eight
 * and having to chase the SDK every time it adds one. Delete once the SDK speaks `entry`.
 */
export function withEntryRenew(api: BulletinTypedApi): BulletinTypedApi {
  const patch = <T extends object>(target: T, key: string, value: unknown): T =>
    new Proxy(target, {
      get: (object, property, receiver) =>
        property === key ? value : (Reflect.get(object, property, receiver) as unknown),
    });

  const storage = api.tx.TransactionStorage;
  const renew = (args: { block: number; index: number }) =>
    // Cast: `BulletinTypedApi` types `renew` with the old argument, which is exactly what
    // this function exists to replace.
    (storage.renew as unknown as (args: { entry: unknown }) => ReturnType<typeof storage.renew>)({
      entry: { type: 'Position', value: { block: args.block, index: args.index } },
    });

  return patch(api, 'tx', patch(api.tx, 'TransactionStorage', patch(storage, 'renew', renew)));
}

export function createBulletinClient(options: CreateBulletinClientOptions): AsyncBulletinClient {
  const { genesisHash, descriptor, signer, config } = options;

  // Resolved before anything is connected, so an unusable configuration fails without
  // leaving a client behind.
  const renewArgs =
    options.renewArgs ?? Object.values(BulletinChain).find(network => network.genesisHash === genesisHash)?.renewArgs;

  if (!renewArgs) {
    throw new Error(
      `Unknown Bulletin Chain ${genesisHash}: pass renewArgs to say whether its TransactionStorage.renew takes ` +
        `{ block, index } ('block-index') or an entry selector ('entry').`,
    );
  }

  const provider = createPapiProvider(genesisHash);
  const polkadotClient = createClient(provider);

  // The descriptor union is structurally compatible with `BulletinTypedApi` apart from
  // `renew`, which `withEntryRenew` reconciles.
  const api = polkadotClient.getTypedApi(descriptor) as unknown as BulletinTypedApi;

  return new AsyncBulletinClient(
    renewArgs === 'entry' ? withEntryRenew(api) : api,
    signer,
    polkadotClient.submit,
    config,
    () => polkadotClient.destroy(),
  );
}
