import type { CodecType, StorageErr, StorageReadV2Err, Subscription } from '@novasamatech/host-api';
import { createHostApi, enumValue } from '@novasamatech/host-api';
import type { ResultAsync } from 'neverthrow';

import type { GenericInterrupt } from './helpers.js';
import { genericInterrupt, resultToPromise, unwrapVersionedResult, unwrapVersionedSubscription } from './helpers.js';
import { sandboxTransport } from './sandboxTransport.js';

export const createLocalStorage = (transport = sandboxTransport) => {
  const supportedVersion = 'v1';
  // `localStorage.read` v2 addresses another product's storage.
  const foreignReadVersion = 'v2';
  const hostApi = createHostApi(transport);
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  // The host answers `localStorage.read` in the version it was asked in; the
  // method's type does not correlate the two, so widen to every version's error.
  type ReadResult = ResultAsync<
    { tag: string; value: Uint8Array | undefined },
    { tag: string; value: CodecType<typeof StorageErr> | CodecType<typeof StorageReadV2Err> }
  >;

  function readBytes(key: string, product?: string): Promise<Uint8Array | undefined> {
    const result: ReadResult =
      product === undefined
        ? hostApi.localStorage.read(enumValue(supportedVersion, key))
        : hostApi.localStorage.read(enumValue(foreignReadVersion, { product, key }));

    return resultToPromise(
      unwrapVersionedResult(product === undefined ? supportedVersion : foreignReadVersion, result),
    );
  }

  function writeBytes(key: string, value: Uint8Array) {
    return resultToPromise(
      unwrapVersionedResult(supportedVersion, hostApi.localStorage.write(enumValue(supportedVersion, [key, value]))),
    );
  }

  function clearKey(key: string) {
    return resultToPromise(
      unwrapVersionedResult(supportedVersion, hostApi.localStorage.clear(enumValue(supportedVersion, key))),
    );
  }

  function subscribeBytes(
    key: string,
    callback: (value: Uint8Array | undefined) => void,
  ): Subscription<GenericInterrupt | undefined> {
    return unwrapVersionedSubscription(
      hostApi.localStorage.subscribe(enumValue(supportedVersion, { key }), item => {
        if (item.tag === supportedVersion) {
          callback(item.value.value);
        }
      }),
      genericInterrupt,
    );
  }

  return {
    async clear(key: string) {
      return clearKey(key);
    },
    // Reads this product's own storage, or — when `product` is given — another
    // product's. A foreign read succeeds only when that product's manifest
    // grants the caller the `storage` scope, and rejects with
    // `StorageReadV2Err.AccessNotGranted` otherwise (for an unknown product as
    // well, so the call cannot probe which products exist).
    async readBytes(key: string, product?: string) {
      return readBytes(key, product);
    },
    async writeBytes(key: string, value: Uint8Array) {
      return writeBytes(key, value);
    },
    async readString(key: string, product?: string) {
      return readBytes(key, product).then(bytes => textDecoder.decode(bytes));
    },
    async writeString(key: string, value: string) {
      return writeBytes(key, textEncoder.encode(value));
    },
    async readJSON(key: string, product?: string) {
      const bytes = await readBytes(key, product);
      if (bytes === undefined || bytes.length === 0) return undefined;
      return JSON.parse(textDecoder.decode(bytes));
    },
    async writeJSON(key: string, value: unknown) {
      return writeBytes(key, textEncoder.encode(JSON.stringify(value)));
    },
    // Emits the current value immediately, then on every later write or clear
    // of the key. `undefined` means the key was cleared or is absent.
    subscribeBytes(
      key: string,
      callback: (value: Uint8Array | undefined) => void,
    ): Subscription<GenericInterrupt | undefined> {
      return subscribeBytes(key, callback);
    },
    subscribeString(
      key: string,
      callback: (value: string | undefined) => void,
    ): Subscription<GenericInterrupt | undefined> {
      return subscribeBytes(key, bytes => callback(bytes === undefined ? undefined : textDecoder.decode(bytes)));
    },
    subscribeJSON(key: string, callback: (value: unknown) => void): Subscription<GenericInterrupt | undefined> {
      return subscribeBytes(key, bytes =>
        callback(bytes === undefined || bytes.length === 0 ? undefined : JSON.parse(textDecoder.decode(bytes))),
      );
    },
  };
};

export const hostLocalStorage = createLocalStorage();
