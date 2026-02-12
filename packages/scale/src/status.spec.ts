import { describe, expect, it } from 'vitest';

import { Status } from './status.js';

describe('Status', () => {
  it('should correctly encode/decode Status', () => {
    const codec = Status('New', 'Used');

    expect(codec.enc('New')).toEqual(new Uint8Array([0]));
    expect(codec.enc('Used')).toEqual(new Uint8Array([1]));

    expect(codec.dec('0x00')).toEqual('New');
    expect(codec.dec('0x01')).toEqual('Used');

    // @ts-expect-error for test
    expect(() => codec.enc('Unknown')).toThrowErrorMatchingInlineSnapshot(`[Error: Unknown status value: Unknown]`);
    expect(() => codec.dec('0x03')).toThrowErrorMatchingInlineSnapshot(`[Error: Unknown status index: 3]`);
  });
});
