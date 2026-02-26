import type { Codec } from 'scale-ts';
import { Option, Struct } from 'scale-ts';
import { describe, expect, it } from 'vitest';

import { lazy } from './lazy.js';

describe('lazy', () => {
  it('should correctly encode/decode lazy', () => {
    type Value = {
      child: Value | undefined;
    };

    const codec: Codec<Value> = Struct({ child: Option(lazy(() => codec)) });

    expect(codec.enc({ child: { child: { child: undefined } } })).toEqual(new Uint8Array([1, 1, 0]));
    expect(codec.dec(new Uint8Array([1, 1, 0]))).toEqual({ child: { child: { child: undefined } } });
  });
});
