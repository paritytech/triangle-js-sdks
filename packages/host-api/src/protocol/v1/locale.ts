import { Struct, _void, str } from 'scale-ts';

export const HostLocale = Struct({
  languageTag: str,
});

export const LocaleSubscribeV1_start = _void;
export const LocaleSubscribeV1_receive = HostLocale;
export const LocaleSubscribeV1_interrupt = _void;
