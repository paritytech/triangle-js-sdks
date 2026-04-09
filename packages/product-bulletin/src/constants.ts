import type { HexString } from '@novasamatech/host-api';
import type { ChainDefinition } from 'polkadot-api';

import {
  bulletin_paseo,
  bulletin_pop_stable,
  bulletin_previewnet,
  bulletin_westend,
} from '../.papi/descriptors/dist/index.js';

export interface BulletinNetwork {
  genesisHash: HexString;
  descriptor: ChainDefinition;
}

/** Known Bulletin Chain networks with genesis hashes and PAPI descriptors. */
export const BulletinChain = {
  westend: {
    genesisHash: '0xee1f44f62e68312c4852f37585941e9b64b5ceae539e4aa112ce9d3cf7bbe9fd',
    descriptor: bulletin_westend,
  },
  paseo: {
    genesisHash: '0x744960c32e3a3df5440e1ecd4d34096f1ce2230d7016a5ada8a765d5a622b4ea',
    descriptor: bulletin_paseo,
  },
  popStable: {
    genesisHash: '0x6fdf4baff0328ddaca1812e6d2f8f26afc439e6e0a339c0094d17013f8da246d',
    descriptor: bulletin_pop_stable,
  },
  previewnet: {
    genesisHash: '0x1c28cc48ee21f4f6dd2712c68c9a416f19cd518cbfe205e70e4d9dd007278fca',
    descriptor: bulletin_previewnet,
  },
} as const satisfies Record<string, BulletinNetwork>;
