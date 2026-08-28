import { Bytes, ErrEnum, Hex, Nullable } from '@novasamatech/scale';
import { _void } from 'scale-ts';

import { CallResult } from '../callError.js';
import { GenericErr } from '../commonCodecs.js';

export const PreimageKey = Hex();
export const PreimageValue = Bytes();

export const PreimageLookupSubscribeV1_start = PreimageKey;
export const PreimageLookupSubscribeV1_receive = Nullable(PreimageValue);
export const PreimageLookupSubscribeV1_interrupt = _void;

export const PreimageSubmitErr = ErrEnum('PreimageSubmitErr', {
  Unknown: [GenericErr, 'Unknown error'],
});

export const PreimageSubmitV1_request = PreimageValue;
export const PreimageSubmitV1_response = CallResult(PreimageKey, PreimageSubmitErr);
