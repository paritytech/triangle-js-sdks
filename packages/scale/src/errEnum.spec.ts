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

  it('should support `instanceof` against the enum itself', () => {
    const A = ErrEnum('A', {
      First: [_void, 'First'],
      Second: [_void, 'Second'],
    });
    const B = ErrEnum('B', {
      Other: [_void, 'Other'],
    });

    const first = new A.First(undefined);
    const other = new B.Other(undefined);

    expect(first instanceof A).toBe(true);
    expect(first instanceof A.First).toBe(true);
    expect(first instanceof A.Second).toBe(false);
    expect(other instanceof A).toBe(false);
    expect(new Error('plain') instanceof A).toBe(false);

    const e: unknown = first;
    if (e instanceof A) {
      expect(e.name).toBe('A::First');
      expect(e.payload).toBeUndefined();
    } else {
      throw new Error('narrowing failed');
    }
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
