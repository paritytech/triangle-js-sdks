import type { Subscription } from '@novasamatech/host-api';
import { createHostApi, enumValue } from '@novasamatech/host-api';

import { resultToPromise, unwrapVersionedResult } from './helpers.js';
import { sandboxTransport } from './sandboxTransport.js';

export const createLocalStorage = (transport = sandboxTransport) => {
  const supportedVersion = 'v1';
  const hostApi = createHostApi(transport);
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  function readBytes(key: string) {
    return resultToPromise(
      unwrapVersionedResult(supportedVersion, hostApi.localStorageRead(enumValue(supportedVersion, key))),
    );
  }

  function writeBytes(key: string, value: Uint8Array) {
    return resultToPromise(
      unwrapVersionedResult(supportedVersion, hostApi.localStorageWrite(enumValue(supportedVersion, [key, value]))),
    );
  }

  function clearKey(key: string) {
    return resultToPromise(
      unwrapVersionedResult(supportedVersion, hostApi.localStorageClear(enumValue(supportedVersion, key))),
    );
  }

  function subscribeBytes(key: string, callback: (value: Uint8Array | undefined) => void): Subscription<void> {
    const subscriber = hostApi.localStorageSubscribe(enumValue(supportedVersion, { key }), item => {
      if (item.tag === supportedVersion) {
        callback(item.value.value);
      }
    });

    return {
      unsubscribe: subscriber.unsubscribe,
      onInterrupt: cb => subscriber.onInterrupt(v => cb(v.value)),
    };
  }

  return {
    async clear(key: string) {
      return clearKey(key);
    },
    async readBytes(key: string) {
      return readBytes(key);
    },
    async writeBytes(key: string, value: Uint8Array) {
      return writeBytes(key, value);
    },
    async readString(key: string) {
      return readBytes(key).then(bytes => textDecoder.decode(bytes));
    },
    async writeString(key: string, value: string) {
      return writeBytes(key, textEncoder.encode(value));
    },
    async readJSON(key: string) {
      const bytes = await readBytes(key);
      if (bytes === undefined || bytes.length === 0) return undefined;
      return JSON.parse(textDecoder.decode(bytes));
    },
    async writeJSON(key: string, value: unknown) {
      return writeBytes(key, textEncoder.encode(JSON.stringify(value)));
    },
    // Emits the current value immediately, then on every later write or clear
    // of the key. `undefined` means the key was cleared or is absent.
    subscribeBytes(key: string, callback: (value: Uint8Array | undefined) => void): Subscription<void> {
      return subscribeBytes(key, callback);
    },
    subscribeString(key: string, callback: (value: string | undefined) => void): Subscription<void> {
      return subscribeBytes(key, bytes => callback(bytes === undefined ? undefined : textDecoder.decode(bytes)));
    },
    subscribeJSON(key: string, callback: (value: unknown) => void): Subscription<void> {
      return subscribeBytes(key, bytes =>
        callback(bytes === undefined || bytes.length === 0 ? undefined : JSON.parse(textDecoder.decode(bytes))),
      );
    },
  };
};

export const hostLocalStorage = createLocalStorage();
