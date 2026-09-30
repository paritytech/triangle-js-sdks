import { Enum, Hex } from '@novasamatech/scale';
import { bool } from 'scale-ts';

import { GenericError } from '../commonCodecs.js';

export const Feature = Enum({
  Chain: Hex(),
});

export const FeatureV1_request = Feature;
export const FeatureV1_response = bool;
export const FeatureV1_error = GenericError;
