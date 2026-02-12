import { Struct, _void, bool } from 'scale-ts';
import { describe, expect, it } from 'vitest';

import { Err } from './err.js';

describe('Err', () => {
  it('should correctly construct Error', () => {
    const ErrorCodec = Err('TestError', _void, 'Test message');
    const error = new ErrorCodec(undefined);

    expect(error).toBeInstanceOf(ErrorCodec);
    expect(error.name).toBe('TestError');
    expect(error.message).toBe('Test message');
  });

  it('should correctly encode/decode Err', () => {
    const payload = Struct({ enable: bool });
    const ErrorCodec = Err('TestError', payload, 'Test message');
    const error = new ErrorCodec({ enable: true });

    expect(ErrorCodec.enc(error)).toEqual(new Uint8Array([1]));
    expect(ErrorCodec.dec(ErrorCodec.enc(error))).toEqual(new ErrorCodec({ enable: true }));
  });
});
