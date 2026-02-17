import { StorageErr, createTransport } from '@novasamatech/host-api';
import { createContainer } from '@novasamatech/host-container';
import { createLocalStorage } from '@novasamatech/product-sdk';

import { describe, expect, it, vi } from 'vitest';

import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

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

      const handler = vi.fn<Parameters<typeof container.handleLocalStorageRead>[0]>((_, { ok }) => ok(expectedValue));
      container.handleLocalStorageRead(handler);

      const result = await localStorage.readBytes(key);

      expect(handler).toBeCalledWith(key, { ok: expect.any(Function), err: expect.any(Function) });
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

      const handler = vi.fn<Parameters<typeof container.handleLocalStorageWrite>[0]>((_, { ok }) => ok(undefined));
      container.handleLocalStorageWrite(handler);

      await localStorage.writeBytes(key, value);

      expect(handler).toBeCalledWith([key, value], { ok: expect.any(Function), err: expect.any(Function) });
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

      const handler = vi.fn<Parameters<typeof container.handleLocalStorageClear>[0]>((_, { ok }) => ok(undefined));
      container.handleLocalStorageClear(handler);

      await localStorage.clear(key);

      expect(handler).toBeCalledWith(key, { ok: expect.any(Function), err: expect.any(Function) });
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

      const handler = vi.fn<Parameters<typeof container.handleLocalStorageWrite>[0]>((_, { ok }) => ok(undefined));
      container.handleLocalStorageWrite(handler);

      await localStorage.writeString(key, value);

      expect(handler).toBeCalledWith([key, expectedBytes], { ok: expect.any(Function), err: expect.any(Function) });
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

      const handler = vi.fn<Parameters<typeof container.handleLocalStorageWrite>[0]>((_, { ok }) => ok(undefined));
      container.handleLocalStorageWrite(handler);

      await localStorage.writeJSON(key, value);

      expect(handler).toBeCalledWith([key, expectedBytes], { ok: expect.any(Function), err: expect.any(Function) });
    });

    it('should handle arrays', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';
      const value = [1, 2, 3, 'four', { five: 5 }];
      const expectedBytes = new TextEncoder().encode(JSON.stringify(value));

      const handler = vi.fn<Parameters<typeof container.handleLocalStorageWrite>[0]>((_, { ok }) => ok(undefined));
      container.handleLocalStorageWrite(handler);

      await localStorage.writeJSON(key, value);

      expect(handler).toBeCalledWith([key, expectedBytes], { ok: expect.any(Function), err: expect.any(Function) });
    });
  });
});
