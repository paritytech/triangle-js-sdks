import type { HexString } from '@novasamatech/host-api';
import { createPapiProvider } from '@novasamatech/product-sdk';
import type { ClientConfig } from '@parity/bulletin-sdk';
import { AsyncBulletinClient } from '@parity/bulletin-sdk';
import type { PolkadotSigner } from 'polkadot-api';
import { createClient } from 'polkadot-api';

import type {
  bulletin_paseo,
  bulletin_pop_stable,
  bulletin_previewnet,
  bulletin_westend,
} from '../.papi/descriptors/dist/index.js';

/** Union of known Bulletin Chain descriptor types. */
export type BulletinDescriptor =
  | typeof bulletin_westend
  | typeof bulletin_paseo
  | typeof bulletin_pop_stable
  | typeof bulletin_previewnet;

export interface CreateBulletinClientOptions {
  /** Bulletin Chain genesis hash — see {@link BulletinChain} for known networks */
  genesisHash: HexString;
  /** PAPI chain descriptor for the target network */
  descriptor: BulletinDescriptor;
  /** PAPI signer for transaction submission */
  signer: PolkadotSigner;
  /** Optional AsyncBulletinClient config (chunk size, manifest behavior) */
  config?: Partial<ClientConfig>;
}

export interface BulletinClientHandle {
  /** The AsyncBulletinClient instance */
  client: AsyncBulletinClient;
  /** Disconnect the underlying PolkadotClient and release resources */
  destroy: () => void;
}

export function createBulletinClient(options: CreateBulletinClientOptions): BulletinClientHandle {
  const { genesisHash, descriptor, signer, config } = options;

  const provider = createPapiProvider(genesisHash);
  const polkadotClient = createClient(provider);

  const api = polkadotClient.getTypedApi(descriptor);
  const client = new AsyncBulletinClient(api, signer, polkadotClient.submit, config);

  return {
    client,
    destroy: () => polkadotClient.destroy(),
  };
}
