import { Struct, _void, str } from 'scale-ts';

import { GenericError } from '../commonCodecs.js';

export const HostLocale = Struct({
  languageTag: str,
});

export const LocaleSubscribeV1_start = _void;
export const LocaleSubscribeV1_receive = HostLocale;
export const LocaleSubscribeV1_interrupt = GenericError;
