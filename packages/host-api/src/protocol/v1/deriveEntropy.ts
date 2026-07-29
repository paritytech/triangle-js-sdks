import { Bytes, ErrEnum } from '@novasamatech/scale';
import { Result } from 'scale-ts';

import { GenericErr } from '../commonCodecs.js';

// common structures

export const DeriveEntropyErr = ErrEnum('DeriveEntropyErr', {
  Unknown: [GenericErr, 'Unknown derive entropy error'],
});

export const Entropy = Bytes(32);

// actions

export const DeriveEntropyV1_request = Bytes();
export const DeriveEntropyV1_response = Result(Entropy, DeriveEntropyErr);
