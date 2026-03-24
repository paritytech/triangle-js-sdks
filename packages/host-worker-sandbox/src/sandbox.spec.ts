import { describe, expect, it } from 'vitest';

import { createSandbox } from './sandbox.js';

describe('createSandbox', () => {
  describe('initialization', () => {
    it('should resolve to a sandbox with a container', async () => {
      const sandbox = await createSandbox('test');
      expect(sandbox.container).toBeDefined();
      sandbox.dispose();
    });

    it('should inject window global with __HOST_WEBVIEW_MARK__', async () => {
      const sandbox = await createSandbox('test');
      await expect(
        sandbox.run('if (!window.__HOST_WEBVIEW_MARK__) throw new Error("missing")'),
      ).resolves.toBeUndefined();
      sandbox.dispose();
    });

    it('should inject port global', async () => {
      const sandbox = await createSandbox('test');
      await expect(
        sandbox.run('if (typeof __HOST_API_PORT__ === "undefined") throw new Error("missing")'),
      ).resolves.toBeUndefined();
      sandbox.dispose();
    });

    it('should inject TextEncoder', async () => {
      const sandbox = await createSandbox('test');
      await expect(sandbox.run('new TextEncoder()')).resolves.toBeUndefined();
      sandbox.dispose();
    });

    it('should inject TextDecoder', async () => {
      const sandbox = await createSandbox('test');
      await expect(sandbox.run('new TextDecoder()')).resolves.toBeUndefined();
      sandbox.dispose();
    });

    it('should inject intervals', async () => {
      const sandbox = await createSandbox('test');
      await expect(
        sandbox.run(`
          const interval = setInterval(() => {}, 1000);
          clearInterval(interval);
        `),
      ).resolves.toBeUndefined();
      sandbox.dispose();
    });

    it('should inject timeouts', async () => {
      const sandbox = await createSandbox('test');
      await expect(
        sandbox.run(`
          const timeout = setTimeout(() => {}, 1000);
          clearTimeout(timeout);
        `),
      ).resolves.toBeUndefined();
      sandbox.dispose();
    });

    it('should inject queueMicrotask', async () => {
      const sandbox = await createSandbox('test');
      await expect(
        sandbox.run(`
          queueMicrotask(() => {});
        `),
      ).resolves.toBeUndefined();
      sandbox.dispose();
    });
  });

  describe('run', () => {
    it('should evaluate code without throwing', async () => {
      const sandbox = await createSandbox('test');
      await expect(sandbox.run('const x = 1 + 2')).resolves.toBeUndefined();
      sandbox.dispose();
    });

    it('should throw on runtime error', async () => {
      const sandbox = await createSandbox('test');
      await expect(sandbox.run('throw new Error("boom")')).rejects.toThrow('Sandbox error');
      sandbox.dispose();
    });

    it('should throw on syntax error', async () => {
      const sandbox = await createSandbox('test');
      await expect(sandbox.run('const = invalid;;')).rejects.toThrow('Sandbox error');
      sandbox.dispose();
    });

    it('should run async IIFE without throwing', async () => {
      const sandbox = await createSandbox('test');
      await expect(sandbox.run('(async () => { await Promise.resolve(); })()')).resolves.toBeUndefined();
      sandbox.dispose();
    });

    it('should deliver data posted inside an async IIFE', async () => {
      const received: number[] = [];
      const sandbox = await createSandbox('test');
      sandbox.provider.subscribe(bytes => received.push(...bytes.subarray(0, 1)));

      await sandbox.run(
        '(async () => { await Promise.resolve(); __HOST_API_PORT__.postMessage(new Uint8Array([7])); })()',
      );

      expect(received).toEqual([7]);
      sandbox.dispose();
    });
  });

  describe('port messaging', () => {
    it('should call provider subscriber when sandbox calls port.postMessage', async () => {
      const sandbox = await createSandbox('test');
      const received: Uint8Array[] = [];
      sandbox.provider.subscribe(bytes => received.push(bytes));

      await sandbox.run('__HOST_API_PORT__.postMessage(new Uint8Array([1, 2, 3]))');

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(new Uint8Array([1, 2, 3]));
      sandbox.dispose();
    });

    it('should deliver bytes to port.onmessage when provider.postMessage is called', async () => {
      const received: number[] = [];
      const sandbox = await createSandbox('test');
      sandbox.provider.subscribe(bytes => received.push(...bytes.subarray(0, 1)));

      await sandbox.run(
        '__HOST_API_PORT__.onmessage = event => { __HOST_API_PORT__.postMessage(new Uint8Array([event.data[0]])); }',
      );
      sandbox.provider.postMessage(new Uint8Array([42]));

      expect(received).toEqual([42]);
      sandbox.dispose();
    });

    it('should deliver bytes to port.addEventListener message handlers', async () => {
      const received: number[] = [];
      const sandbox = await createSandbox('test');
      sandbox.provider.subscribe(bytes => received.push(...bytes.subarray(0, 1)));

      await sandbox.run(
        `__HOST_API_PORT__.addEventListener('message', event => { __HOST_API_PORT__.postMessage(new Uint8Array([event.data[0]])); })`,
      );
      sandbox.provider.postMessage(new Uint8Array([99]));

      expect(received).toEqual([99]);
      sandbox.dispose();
    });

    it('should deliver to both onmessage and addEventListener handlers', async () => {
      const received: number[] = [];
      const sandbox = await createSandbox('test');
      sandbox.provider.subscribe(bytes => received.push(...bytes.subarray(0, 1)));

      await sandbox.run(`
        __HOST_API_PORT__.onmessage = event => { __HOST_API_PORT__.postMessage(new Uint8Array([event.data[0]])); };
        __HOST_API_PORT__.addEventListener('message', event => { __HOST_API_PORT__.postMessage(new Uint8Array([event.data[0] + 10])); });
      `);
      sandbox.provider.postMessage(new Uint8Array([5]));

      // onmessage fires first, then addEventListener handlers
      expect(received).toEqual([5, 15]);
      sandbox.dispose();
    });

    it('should clear the subscriber when the returned unsubscribe is called', async () => {
      const sandbox = await createSandbox('test');
      const received: Uint8Array[] = [];
      const unsubscribe = sandbox.provider.subscribe(bytes => received.push(bytes));

      unsubscribe();
      await sandbox.run('__HOST_API_PORT__.postMessage(new Uint8Array([1]))');

      expect(received).toHaveLength(0);
      sandbox.dispose();
    });

    it('should read and set port.onmessage via the getter', async () => {
      const sandbox = await createSandbox('test');

      await sandbox.run(`
        if (__HOST_API_PORT__.onmessage !== null) throw new Error('expected null');
        __HOST_API_PORT__.onmessage = () => {};
        if (typeof __HOST_API_PORT__.onmessage !== 'function') throw new Error('expected function');
      `);

      await expect(sandbox.run('')).resolves.toBeUndefined();
      sandbox.dispose();
    });
  });

  describe('dispose', () => {
    it('should not throw when disposing with active subscriptions and handlers', async () => {
      const sandbox = await createSandbox('test');
      await sandbox.run(`
        __HOST_API_PORT__.onmessage = () => {};
        __HOST_API_PORT__.addEventListener('message', () => {});
      `);
      expect(() => sandbox.dispose()).not.toThrow();
    });

    it('should stop delivering messages after dispose', async () => {
      const received: number[] = [];
      const sandbox = await createSandbox('test');
      sandbox.provider.subscribe(bytes => received.push(...bytes.subarray(0, 1)));

      await sandbox.run(
        '__HOST_API_PORT__.onmessage = event => { __HOST_API_PORT__.postMessage(new Uint8Array([event.data[0]])); }',
      );
      sandbox.dispose();

      // provider.postMessage after dispose must not throw even though the vm is gone
      expect(() => sandbox.provider.postMessage(new Uint8Array([1]))).not.toThrow();
      expect(received).toHaveLength(0);
    });
  });
});
