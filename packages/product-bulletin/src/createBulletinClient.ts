import type { HexString } from '@novasamatech/host-api';
import { createPapiProvider } from '@novasamatech/product-sdk';
import type { BulletinTypedApi, ClientConfig } from '@parity/bulletin-sdk';
import { AsyncBulletinClient } from '@parity/bulletin-sdk';
import type { ChainDefinition, PolkadotSigner } from 'polkadot-api';
import { createClient } from 'polkadot-api';

export interface CreateBulletinClientOptions {
  /** Bulletin Chain genesis hash — see {@link BulletinChain} for known networks */
  genesisHash: HexString;
  /** PAPI chain descriptor for the target network */
  descriptor: ChainDefinition;
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

  const api = polkadotClient.getTypedApi(descriptor) as unknown as BulletinTypedApi;
  const client = new AsyncBulletinClient(api, signer, polkadotClient.submit, config);

  return {
    client,
    destroy: () => polkadotClient.destroy(),
  };
}
