import { enhanceCodec, u8 } from 'scale-ts';

/**
 * Optimized version of `Option(bool)`.
 *
 * Canonical SCALE encoding (matches `parity_scale_codec::OptionBool`):
 * `undefined` → 0, `true` → 1, `false` → 2.
 */
export const OptionBool = enhanceCodec<number, boolean | void>(
  u8,
  value => {
    if (value === undefined) {
      return 0;
    }
    return value ? 1 : 2;
  },
  v => {
    switch (v) {
      case 0:
        return undefined;
      case 1:
        return true;
      case 2:
        return false;
      default:
        throw new Error(`Unknown value for optionBool: ${v}. Should be ether 0, 1 or 2.`);
    }
  },
);
