import { nanoid } from 'nanoid';

import type { ComposeMessageAction } from './protocol/messageCodec.js';

export function delay(ttl: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ttl));
}

type PromiseWithResolvers<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

export const promiseWithResolvers = <const T>(): PromiseWithResolvers<T> => {
  let resolve: (value: T) => void;
  let reject: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  // @ts-expect-error before assign
  return { promise, resolve, reject };
};

export function composeAction<const Method extends string, const Suffix extends string>(
  method: Method,
  suffix: Suffix,
) {
  return `${method}_${suffix}` as ComposeMessageAction<Method, Suffix>;
}

export function createRequestId() {
  return nanoid(8);
}

export function extractErrorMessage(err: unknown) {
  if (err instanceof Error) {
    return err.message;
  }

  if (err) {
    return err.toString();
  }

  return 'Unknown error occurred.';
}
