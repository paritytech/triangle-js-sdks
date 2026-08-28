import { StorageErr, createTransport } from '@novasamatech/host-api';
import { createLocalStorage } from '@novasamatech/host-api-wrapper';
import type { ContainerHandlerOf } from '@novasamatech/host-container';
import { createContainer } from '@novasamatech/host-container';

import { describe, expect, it, vi } from 'vitest';

import { delay } from './__mocks__/helpers.js';
import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

// eslint-disable-next-line @typescript-eslint/no-empty-function
function noop() {}

function setup() {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host);
  const sdkTransport = createTransport(providers.sdk);
  const localStorage = createLocalStorage(sdkTransport);

  return { container, localStorage };
}

describe('Host API: LocalStorage', () => {
  describe('readBytes', () => {
    it('should read bytes from storage', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';
      const expectedValue = new Uint8Array([1, 2, 3, 4]);

      const handler = vi.fn<ContainerHandlerOf<typeof container.handleLocalStorageRead>>((_, { ok }) =>
        ok(expectedValue),
      );
      container.handleLocalStorageRead(handler);

      const result = await localStorage.readBytes(key);

      expect(handler).toHaveBeenCalledWith(key, { ok: expect.any(Function), err: expect.any(Function) });
      expect(result).toEqual(expectedValue);
    });

    it('should handle read error', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';
      const error = new StorageErr.Unknown({ reason: 'Read failed' });

      container.handleLocalStorageRead((_, { err }) => err(error));

      await expect(localStorage.readBytes(key)).rejects.toEqual(error);
    });
  });

  describe('writeBytes', () => {
    it('should write bytes to storage', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';
      const value = new Uint8Array([5, 6, 7, 8]);

      const handler = vi.fn<ContainerHandlerOf<typeof container.handleLocalStorageWrite>>((_, { ok }) => ok(undefined));
      container.handleLocalStorageWrite(handler);

      await localStorage.writeBytes(key, value);

      expect(handler).toHaveBeenCalledWith([key, value], { ok: expect.any(Function), err: expect.any(Function) });
    });

    it('should handle write error when storage is full', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';
      const value = new Uint8Array([1, 2, 3]);
      const error = new StorageErr.Full();

      container.handleLocalStorageWrite((_, { err }) => err(error));

      await expect(localStorage.writeBytes(key, value)).rejects.toEqual(error);
    });
  });

  describe('clear', () => {
    it('should clear a key from storage', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';

      const handler = vi.fn<ContainerHandlerOf<typeof container.handleLocalStorageClear>>((_, { ok }) => ok(undefined));
      container.handleLocalStorageClear(handler);

      await localStorage.clear(key);

      expect(handler).toHaveBeenCalledWith(key, { ok: expect.any(Function), err: expect.any(Function) });
    });

    it('should handle clear error', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';
      const error = new StorageErr.Unknown({ reason: 'Clear failed' });

      container.handleLocalStorageClear((_, { err }) => err(error));

      await expect(localStorage.clear(key)).rejects.toEqual(error);
    });
  });

  describe('readString', () => {
    it('should read and decode string from storage', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';
      const expectedString = 'Hello, World!';
      const encodedValue = new TextEncoder().encode(expectedString);

      container.handleLocalStorageRead((_, { ok }) => ok(encodedValue));

      const result = await localStorage.readString(key);

      expect(result).toBe(expectedString);
    });
  });

  describe('writeString', () => {
    it('should encode and write string to storage', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';
      const value = 'Hello, World!';
      const expectedBytes = new TextEncoder().encode(value);

      const handler = vi.fn<ContainerHandlerOf<typeof container.handleLocalStorageWrite>>((_, { ok }) => ok(undefined));
      container.handleLocalStorageWrite(handler);

      await localStorage.writeString(key, value);

      expect(handler).toHaveBeenCalledWith([key, expectedBytes], {
        ok: expect.any(Function),
        err: expect.any(Function),
      });
    });
  });

  describe('readJSON', () => {
    it('should read and parse JSON from storage', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';
      const expectedObject = { name: 'test', count: 42, nested: { active: true } };
      const encodedValue = new TextEncoder().encode(JSON.stringify(expectedObject));

      container.handleLocalStorageRead((_, { ok }) => ok(encodedValue));

      const result = await localStorage.readJSON(key);

      expect(result).toEqual(expectedObject);
    });

    it('should return undefined for a missing key', async () => {
      const { container, localStorage } = setup();
      const key = 'never-written';

      // Host returns `undefined` for a key that was never written.
      container.handleLocalStorageRead((_, { ok }) => ok(undefined));

      await expect(localStorage.readJSON(key)).resolves.toBeUndefined();
    });

    it('should return undefined for an empty stored value', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';

      container.handleLocalStorageRead((_, { ok }) => ok(new Uint8Array()));

      await expect(localStorage.readJSON(key)).resolves.toBeUndefined();
    });

    it('should handle invalid JSON', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';
      const invalidJson = new TextEncoder().encode('not valid json');

      container.handleLocalStorageRead((_, { ok }) => ok(invalidJson));

      await expect(localStorage.readJSON(key)).rejects.toThrow();
    });
  });

  describe('writeJSON', () => {
    it('should stringify and write JSON to storage', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';
      const value = { name: 'test', count: 42, nested: { active: true } };
      const expectedBytes = new TextEncoder().encode(JSON.stringify(value));

      const handler = vi.fn<ContainerHandlerOf<typeof container.handleLocalStorageWrite>>((_, { ok }) => ok(undefined));
      container.handleLocalStorageWrite(handler);

      await localStorage.writeJSON(key, value);

      expect(handler).toHaveBeenCalledWith([key, expectedBytes], {
        ok: expect.any(Function),
        err: expect.any(Function),
      });
    });

    it('should handle arrays', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';
      const value = [1, 2, 3, 'four', { five: 5 }];
      const expectedBytes = new TextEncoder().encode(JSON.stringify(value));

      const handler = vi.fn<ContainerHandlerOf<typeof container.handleLocalStorageWrite>>((_, { ok }) => ok(undefined));
      container.handleLocalStorageWrite(handler);

      await localStorage.writeJSON(key, value);

      expect(handler).toHaveBeenCalledWith([key, expectedBytes], {
        ok: expect.any(Function),
        err: expect.any(Function),
      });
    });
  });

  describe('subscribe', () => {
    it('delivers the current value, each change, and a clear', async () => {
      const { container, localStorage } = setup();

      container.handleLocalStorageSubscribe((_key, send) => {
        send({ value: new Uint8Array([1, 2, 3]) });
        send({ value: new Uint8Array([4]) });
        send({ value: undefined });
        return noop;
      });

      const received: (Uint8Array | undefined)[] = [];
      localStorage.subscribeBytes('funding', value => received.push(value));

      await delay(50);

      expect(received).toEqual([new Uint8Array([1, 2, 3]), new Uint8Array([4]), undefined]);
    });

    it('subscribes with the requested key as the start payload', async () => {
      const { container, localStorage } = setup();
      const handler = vi.fn<ContainerHandlerOf<typeof container.handleLocalStorageSubscribe>>(() => noop);
      container.handleLocalStorageSubscribe(handler);

      localStorage.subscribeBytes('the-key', noop);

      await delay(50);

      expect(handler).toHaveBeenCalledWith({ key: 'the-key' }, expect.anything(), expect.anything());
    });
  });
});
