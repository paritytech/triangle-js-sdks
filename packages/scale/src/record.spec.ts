import { Option, u8 } from 'scale-ts';
import { describe, expect, it } from 'vitest';

import { Record } from './record.js';

describe('Record', () => {
  it('should correctly encode/decode Record', () => {
    const codec = Record(u8);

    expect(codec.enc({ x: 1, y: 2 })).toEqual(new Uint8Array([8, 4, 120, 1, 4, 121, 2]));
    expect(codec.dec(new Uint8Array([8, 4, 120, 1, 4, 121, 2]))).toEqual({ y: 2, x: 1 });
  });

  it('should correctly encode/decode Record with Optional', () => {
    const codec = Record(Option(u8));

    expect(codec.enc({ x: 1, y: undefined })).toMatchInlineSnapshot(`
      Uint8Array [
        8,
        4,
        120,
        1,
        1,
        4,
        121,
        0,
      ]
    `);
  });
});
