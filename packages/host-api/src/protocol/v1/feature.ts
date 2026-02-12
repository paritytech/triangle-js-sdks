import { Enum } from '@novasamatech/scale';
import { Result, bool } from 'scale-ts';

import { GenericError, GenesisHash } from '../commonCodecs.js';

export const Feature = Enum({
  Chain: GenesisHash,
});

export const FeatureV1_request = Feature;
export const FeatureV1_response = Result(bool, GenericError);
