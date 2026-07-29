import { Err, Hex } from '@novasamatech/scale';
import { Struct, str } from 'scale-ts';

/** A 32-byte chain genesis hash used to identify the target chain. */
export const GenesisHash = Hex(32);

export const GenericErr = Struct({
  reason: str,
});

export const GenericError = Err('GenericError', GenericErr, ({ reason }) => `Unknown error: ${reason}`);
