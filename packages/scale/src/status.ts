import { enhanceCodec, u8 } from 'scale-ts';

/**
 * Enum without values
 */
export function Status<const T>(...list: T[]) {
  return enhanceCodec<number, T>(
    u8,
    v => {
      const i = list.indexOf(v);
      if (i === -1) {
        throw new Error(`Unknown status value: ${v}`);
      }
      return i;
    },
    i => {
      const v = list.at(i);
      if (v === undefined) {
        throw new Error(`Unknown status index: ${i}`);
      }
      return v;
    },
  );
}
