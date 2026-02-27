import { enhanceCodec, u8 } from 'scale-ts';

/**
 * Optimized version of `Option(bool)`
 */
export const OptionBool = enhanceCodec<number, boolean | void>(
  u8,
  value => {
    if (value === undefined) {
      return 0;
    }
    return value ? 2 : 1;
  },
  v => {
    switch (v) {
      case 0:
        return undefined;
      case 1:
        return false;
      case 2:
        return true;
      default:
        throw new Error(`Unknown value for optionBool: ${v}. Should be ether 0, 1 or 2.`);
    }
  },
);
