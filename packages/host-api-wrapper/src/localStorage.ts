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
      return readBytes(key)
        .then(bytes => textDecoder.decode(bytes))
        .then(JSON.parse);
    },
    async writeJSON(key: string, value: unknown) {
      return writeBytes(key, textEncoder.encode(JSON.stringify(value)));
    },
  };
};

export const hostLocalStorage = createLocalStorage();
