import { Err, Hex } from '@novasamatech/scale';
import { Struct, str } from 'scale-ts';

export const GenesisHash = Hex();

export const GenericErr = Struct({
  reason: str,
});

export const GenericError = Err('GenericError', GenericErr, ({ reason }) => `Unknown error: ${reason}`);
