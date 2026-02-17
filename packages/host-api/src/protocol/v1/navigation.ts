import { ErrEnum } from '@novasamatech/scale';
import { Result, _void, str } from 'scale-ts';

import { GenericErr } from '../commonCodecs.js';

export const NavigateToErr = ErrEnum('NavigateToErr', {
  PermissionDenied: [_void, 'Permission denied'],
  Unknown: [GenericErr, 'Unknown error'],
});

export const NavigateToV1_request = str;
export const NavigateToV1_response = Result(_void, NavigateToErr);
