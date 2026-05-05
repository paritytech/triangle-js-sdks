import { Status } from '@novasamatech/scale';
import { _void } from 'scale-ts';

export const Theme = Status('light', 'dark');

export const ThemeSubscribeV1_start = _void;
export const ThemeSubscribeV1_receive = Theme;
export const ThemeSubscribeV1_interrupt = _void;
