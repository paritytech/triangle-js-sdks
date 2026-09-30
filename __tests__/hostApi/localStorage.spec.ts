import { StorageErr, StorageReadV2Err, createTransport } from '@novasamatech/host-api';
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

      const handler = vi.fn<ContainerHandlerOf<typeof container.localStorage.handleRead>>((_, { ok }) =>
        ok(expectedValue),
      );
      container.localStorage.handleRead(handler);

      const result = await localStorage.readBytes(key);

      // A v1 read (a bare key) reaches the handler in the v2 shape, addressing the caller's own storage.
      expect(handler).toHaveBeenCalledWith(
        { product: undefined, key },
        { ok: expect.any(Function), err: expect.any(Function), signal: expect.any(AbortSignal) },
      );
      expect(result).toEqual(expectedValue);
    });

    it('should handle read error', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';

      container.localStorage.handleRead((_, { err }) => err(new StorageReadV2Err.Unknown({ reason: 'Read failed' })));

      // The v1 caller receives the v1 error type.
      await expect(localStorage.readBytes(key)).rejects.toEqual(new StorageErr.Unknown({ reason: 'Read failed' }));
    });

    it('should downgrade a Full read error to the v1 error type', async () => {
      const { container, localStorage } = setup();

      container.localStorage.handleRead((_, { err }) => err(new StorageReadV2Err.Full()));

      await expect(localStorage.readBytes('test-key')).rejects.toEqual(new StorageErr.Full());
    });

    it('should downgrade AccessNotGranted to StorageErr.Unknown for a v1 read', async () => {
      const { container, localStorage } = setup();

      container.localStorage.handleRead((_, { err }) => err(new StorageReadV2Err.AccessNotGranted()));

      const error = await localStorage.readBytes('test-key').then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(StorageErr.Unknown);
      expect(error).toEqual(
        new StorageErr.Unknown({ reason: 'the owning product grants no read access to its storage' }),
      );
    });
  });

  describe('reading another product', () => {
    const otherProduct = 'other-product.dot';

    it('should address the named product with a v2 read', async () => {
      const { container, localStorage } = setup();
      const key = 'shared-key';
      const expectedValue = new Uint8Array([9, 8, 7]);

      const handler = vi.fn<ContainerHandlerOf<typeof container.localStorage.handleRead>>((_, { ok }) =>
        ok(expectedValue),
      );
      container.localStorage.handleRead(handler);

      const result = await localStorage.readBytes(key, otherProduct);

      expect(handler).toHaveBeenCalledWith(
        { product: otherProduct, key },
        { ok: expect.any(Function), err: expect.any(Function), signal: expect.any(AbortSignal) },
      );
      expect(result).toEqual(expectedValue);
    });

    it('should decode strings and JSON read from another product', async () => {
      const { container, localStorage } = setup();
      const stored = new Map<string, Uint8Array>([
        [`${otherProduct}/greeting`, new TextEncoder().encode('Hello')],
        [`${otherProduct}/config`, new TextEncoder().encode(JSON.stringify({ theme: 'dark' }))],
      ]);

      container.localStorage.handleRead(({ product, key }, { ok }) => ok(stored.get(`${product}/${key}`)));

      await expect(localStorage.readString('greeting', otherProduct)).resolves.toBe('Hello');
      await expect(localStorage.readJSON('config', otherProduct)).resolves.toEqual({ theme: 'dark' });
      await expect(localStorage.readJSON('absent', otherProduct)).resolves.toBeUndefined();
    });

    it('should reject with StorageReadV2Err.AccessNotGranted when the product grants no access', async () => {
      const { container, localStorage } = setup();

      container.localStorage.handleRead(({ product }, { ok, err }) =>
        product === undefined ? ok(new Uint8Array([1])) : err(new StorageReadV2Err.AccessNotGranted()),
      );

      const error = await localStorage.readBytes('shared-key', otherProduct).then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(StorageReadV2Err.AccessNotGranted);
      expect(error).toEqual(new StorageReadV2Err.AccessNotGranted());
      // The caller's own storage stays readable.
      await expect(localStorage.readBytes('shared-key')).resolves.toEqual(new Uint8Array([1]));
    });

    it('should pass v2 Full and Unknown errors through unchanged', async () => {
      const { container, localStorage } = setup();
      const unknown = new StorageReadV2Err.Unknown({ reason: 'backend down' });

      const unregister = container.localStorage.handleRead((_, { err }) => err(new StorageReadV2Err.Full()));
      await expect(localStorage.readBytes('k', otherProduct)).rejects.toEqual(new StorageReadV2Err.Full());
      unregister();

      container.localStorage.handleRead((_, { err }) => err(unknown));
      await expect(localStorage.readBytes('k', otherProduct)).rejects.toEqual(unknown);
    });
  });

  describe('writeBytes', () => {
    it('should write bytes to storage', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';
      const value = new Uint8Array([5, 6, 7, 8]);

      const handler = vi.fn<ContainerHandlerOf<typeof container.localStorage.handleWrite>>((_, { ok }) =>
        ok(undefined),
      );
      container.localStorage.handleWrite(handler);

      await localStorage.writeBytes(key, value);

      expect(handler).toHaveBeenCalledWith([key, value], {
        ok: expect.any(Function),
        err: expect.any(Function),
        signal: expect.any(AbortSignal),
      });
    });

    it('should handle write error when storage is full', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';
      const value = new Uint8Array([1, 2, 3]);
      const error = new StorageErr.Full();

      container.localStorage.handleWrite((_, { err }) => err(error));

      await expect(localStorage.writeBytes(key, value)).rejects.toEqual(error);
    });
  });

  describe('clear', () => {
    it('should clear a key from storage', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';

      const handler = vi.fn<ContainerHandlerOf<typeof container.localStorage.handleClear>>((_, { ok }) =>
        ok(undefined),
      );
      container.localStorage.handleClear(handler);

      await localStorage.clear(key);

      expect(handler).toHaveBeenCalledWith(key, {
        ok: expect.any(Function),
        err: expect.any(Function),
        signal: expect.any(AbortSignal),
      });
    });

    it('should handle clear error', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';
      const error = new StorageErr.Unknown({ reason: 'Clear failed' });

      container.localStorage.handleClear((_, { err }) => err(error));

      await expect(localStorage.clear(key)).rejects.toEqual(error);
    });
  });

  describe('readString', () => {
    it('should read and decode string from storage', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';
      const expectedString = 'Hello, World!';
      const encodedValue = new TextEncoder().encode(expectedString);

      container.localStorage.handleRead((_, { ok }) => ok(encodedValue));

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

      const handler = vi.fn<ContainerHandlerOf<typeof container.localStorage.handleWrite>>((_, { ok }) =>
        ok(undefined),
      );
      container.localStorage.handleWrite(handler);

      await localStorage.writeString(key, value);

      expect(handler).toHaveBeenCalledWith([key, expectedBytes], {
        ok: expect.any(Function),
        err: expect.any(Function),
        signal: expect.any(AbortSignal),
      });
    });
  });

  describe('readJSON', () => {
    it('should read and parse JSON from storage', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';
      const expectedObject = { name: 'test', count: 42, nested: { active: true } };
      const encodedValue = new TextEncoder().encode(JSON.stringify(expectedObject));

      container.localStorage.handleRead((_, { ok }) => ok(encodedValue));

      const result = await localStorage.readJSON(key);

      expect(result).toEqual(expectedObject);
    });

    it('should return undefined for a missing key', async () => {
      const { container, localStorage } = setup();
      const key = 'never-written';

      // Host returns `undefined` for a key that was never written.
      container.localStorage.handleRead((_, { ok }) => ok(undefined));

      await expect(localStorage.readJSON(key)).resolves.toBeUndefined();
    });

    it('should return undefined for an empty stored value', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';

      container.localStorage.handleRead((_, { ok }) => ok(new Uint8Array()));

      await expect(localStorage.readJSON(key)).resolves.toBeUndefined();
    });

    it('should handle invalid JSON', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';
      const invalidJson = new TextEncoder().encode('not valid json');

      container.localStorage.handleRead((_, { ok }) => ok(invalidJson));

      await expect(localStorage.readJSON(key)).rejects.toThrow();
    });
  });

  describe('writeJSON', () => {
    it('should stringify and write JSON to storage', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';
      const value = { name: 'test', count: 42, nested: { active: true } };
      const expectedBytes = new TextEncoder().encode(JSON.stringify(value));

      const handler = vi.fn<ContainerHandlerOf<typeof container.localStorage.handleWrite>>((_, { ok }) =>
        ok(undefined),
      );
      container.localStorage.handleWrite(handler);

      await localStorage.writeJSON(key, value);

      expect(handler).toHaveBeenCalledWith([key, expectedBytes], {
        ok: expect.any(Function),
        err: expect.any(Function),
        signal: expect.any(AbortSignal),
      });
    });

    it('should handle arrays', async () => {
      const { container, localStorage } = setup();
      const key = 'test-key';
      const value = [1, 2, 3, 'four', { five: 5 }];
      const expectedBytes = new TextEncoder().encode(JSON.stringify(value));

      const handler = vi.fn<ContainerHandlerOf<typeof container.localStorage.handleWrite>>((_, { ok }) =>
        ok(undefined),
      );
      container.localStorage.handleWrite(handler);

      await localStorage.writeJSON(key, value);

      expect(handler).toHaveBeenCalledWith([key, expectedBytes], {
        ok: expect.any(Function),
        err: expect.any(Function),
        signal: expect.any(AbortSignal),
      });
    });
  });

  describe('subscribe', () => {
    it('delivers the current value, each change, and a clear', async () => {
      const { container, localStorage } = setup();

      container.localStorage.handleSubscribe((_key, send) => {
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
      const handler = vi.fn<ContainerHandlerOf<typeof container.localStorage.handleSubscribe>>(() => noop);
      container.localStorage.handleSubscribe(handler);

      localStorage.subscribeBytes('the-key', noop);

      await delay(50);

      expect(handler).toHaveBeenCalledWith({ key: 'the-key' }, expect.anything(), expect.anything());
    });
  });
});
