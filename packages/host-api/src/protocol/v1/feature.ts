import { Enum, Hex } from '@novasamatech/scale';
import { Result, bool } from 'scale-ts';

import { GenericError } from '../commonCodecs.js';

export const Feature = Enum({
  Chain: Hex(),
});

export const FeatureV1_request = Feature;
export const FeatureV1_response = Result(bool, GenericError);
