import { _void } from 'scale-ts';
import { describe, expect, it } from 'vitest';

import { ErrEnum } from './errEnum.js';

describe('ErrEnum', () => {
  it('should correctly construct ErrorEnum field', () => {
    const ErrorCodec = ErrEnum('ErrorCodec', {
      TestError: [_void, 'Test message'],
    });

    const error = new ErrorCodec.TestError(undefined);

    expect(error).toBeInstanceOf(ErrorCodec.TestError);
    expect(error.name).toBe('ErrorCodec::TestError');
    expect(error.message).toBe('Test message');
  });

  it('should correctly serialize/deserialize', () => {
    const ErrorCodec = ErrEnum('ErrorCodec', {
      First: [_void, 'First'],
      Second: [_void, 'Second'],
    });

    const first = new ErrorCodec.First(undefined);
    const second = new ErrorCodec.Second(undefined);

    expect(ErrorCodec.enc(first)).toEqual(new Uint8Array([0]));
    expect(ErrorCodec.enc(second)).toEqual(new Uint8Array([1]));

    expect(ErrorCodec.dec(ErrorCodec.enc(first))).toEqual(first);
    expect(ErrorCodec.dec(ErrorCodec.enc(second))).toEqual(second);

    expect(ErrorCodec.dec(ErrorCodec.enc(first))).not.toEqual(second);
    expect(ErrorCodec.dec(ErrorCodec.enc(second))).not.toEqual(first);
  });
});
