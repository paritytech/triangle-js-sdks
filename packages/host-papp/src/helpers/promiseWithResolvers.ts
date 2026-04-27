export type PromiseWithResolvers<T> = {
  promise: PromiseLike<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

export const promiseWithResolvers = <T>(): PromiseWithResolvers<T> => {
  let resolve: (value: T) => void;
  let reject: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  // @ts-expect-error before assign
  return { promise, resolve, reject };
};
