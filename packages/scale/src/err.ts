import type { Codec } from 'scale-ts';
import { enhanceCodec } from 'scale-ts';

// types

export type CodecError<T, Name extends string> = Error & { name: Name; instance: string; payload: T };

export type ErrCodec<T, Name extends string> = Codec<CodecError<T, Name>> & CodecErrorConstructor<T, Name>;

// helpers

type Constructor<A extends Array<any>, T> = new (...args: A) => T;
type CodecErrorConstructor<T, Name extends string> = Constructor<
  T extends undefined ? [void] : [T],
  CodecError<T, Name>
>;

export function Err<const T, const Name extends string>(
  name: Name,
  value: Codec<T>,
  message: string | ((value: NoInfer<T>) => string),
  className: string = name,
): ErrCodec<T, Name> {
  // Defining class with dynamic name
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const C: CodecErrorConstructor<T, Name> = {
    [className]: class extends Error {
      public readonly instance = className;
      public readonly name = name;
      public readonly payload: T;
      constructor(data: any) {
        super(typeof message === 'function' ? message(data) : message);
        this.payload = data;
      }
      // codec array destructuring workaround
      static [Symbol.iterator]() {
        return errorCodec[Symbol.iterator]();
      }
      // codec fields access workaround
      get enc() {
        return errorCodec.enc;
      }
      get dec() {
        return errorCodec.dec;
      }
    },
  }[className]!;

  const errorCodec = enhanceCodec<T, InstanceType<typeof C>>(
    value,
    v => v.payload,
    // @ts-expect-error don't want to fix it really
    v => new C(v as any),
  );

  return Object.assign(C, errorCodec);
}
