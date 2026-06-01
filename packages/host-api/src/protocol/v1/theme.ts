import { Enum, Status } from '@novasamatech/scale';
import { Struct, _void, str } from 'scale-ts';

export const ThemeName = Enum({
  Custom: str,
  Default: _void,
});

export const ThemeVariant = Status('Light', 'Dark');

export const Theme = Struct({
  name: ThemeName,
  variant: ThemeVariant,
});

export const ThemeSubscribeV1_start = _void;
export const ThemeSubscribeV1_receive = Theme;
export const ThemeSubscribeV1_interrupt = _void;
