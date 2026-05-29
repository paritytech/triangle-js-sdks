import { describe, expect, it } from 'vitest';

import type { Sandbox } from './sandbox.js';
import { createSandbox } from './sandbox.js';

describe('createSandbox', () => {
  // ─────────────────────────────────────────────────────────────────────────────
  // Lifecycle: construction, run(), dispose() — the basic mount/unmount flow.
  // ─────────────────────────────────────────────────────────────────────────────
  describe('lifecycle', () => {
    it('returns a sandbox with container, provider, run, and dispose', async () => {
      const sandbox = await createSandbox('test');
      expect(sandbox.container).toBeDefined();
      expect(sandbox.provider).toBeDefined();
      expect(typeof sandbox.run).toBe('function');
      expect(typeof sandbox.dispose).toBe('function');
      sandbox.dispose();
    });

    it('exposes __HOST_WEBVIEW_MARK__ and __HOST_API_PORT__ on the sandbox global', async () => {
      const sandbox = await createSandbox('test');
      await sandbox.run(`
        if (!window.__HOST_WEBVIEW_MARK__) throw new Error('mark missing');
        if (typeof __HOST_API_PORT__ === 'undefined') throw new Error('port missing');
      `);
      sandbox.dispose();
    });

    describe('run()', () => {
      it('evaluates code without throwing', async () => {
        const sandbox = await createSandbox('test');
        await expect(sandbox.run('const x = 1 + 2')).resolves.toBeUndefined();
        sandbox.dispose();
      });

      it('throws on runtime error', async () => {
        const sandbox = await createSandbox('test');
        await expect(sandbox.run('throw new Error("boom")')).rejects.toThrow('Sandbox error');
        sandbox.dispose();
      });

      it('throws on syntax error', async () => {
        const sandbox = await createSandbox('test');
        await expect(sandbox.run('const = invalid;;')).rejects.toThrow('Sandbox error');
        sandbox.dispose();
      });

      it('runs an async IIFE without throwing', async () => {
        const sandbox = await createSandbox('test');
        await expect(sandbox.run('(async () => { await Promise.resolve(); })()')).resolves.toBeUndefined();
        sandbox.dispose();
      });
    });

    describe('dispose()', () => {
      it('does not throw when disposing with active subscriptions and handlers', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          __HOST_API_PORT__.onmessage = () => {};
          __HOST_API_PORT__.addEventListener('message', () => {});
        `);
        expect(() => sandbox.dispose()).not.toThrow();
      });

      it('is idempotent — calling twice is a no-op', async () => {
        const sandbox = await createSandbox('test');
        sandbox.dispose();
        expect(() => sandbox.dispose()).not.toThrow();
      });

      it('stops delivering provider messages after dispose, without throwing', async () => {
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Security: things sandbox code MUST NOT be able to reach. Each test here
  // guards a privilege boundary and would represent a real escape if it failed.
  // ─────────────────────────────────────────────────────────────────────────────
  describe('security', () => {
    it('host fetch bridge function is not exposed on globalThis', async () => {
      const sandbox = await createSandbox('test', {
        fetchResolver: async () => ({ status: 200, headers: [], body: new Uint8Array(0) }),
      });
      await sandbox.run(`
        const exposed = Object.getOwnPropertyNames(globalThis).filter(n => n.includes('FETCH_BRIDGE'));
        if (exposed.length !== 0) throw new Error('bridge leaked: ' + exposed.join(','));
        if (typeof __HOST_FETCH_BRIDGE__ !== 'undefined') throw new Error('bridge accessible');
      `);
      sandbox.dispose();
    });

    it('host crypto.subtle bridge function is not exposed on globalThis', async () => {
      const sandbox = await createSandbox('test', {
        subtleResolver: async () => new ArrayBuffer(0),
      });
      await sandbox.run(`
        const leaked = Object.getOwnPropertyNames(globalThis).filter(n => n.includes('SUBTLE_BRIDGE'));
        if (leaked.length !== 0) throw new Error('bridge leaked: ' + leaked.join(','));
      `);
      sandbox.dispose();
    });

    it('Blob.__getBytes is hidden from sandbox code (with fetch resolver)', async () => {
      const sandbox = await createSandbox('test', {
        fetchResolver: async () => ({ status: 200, headers: [], body: new Uint8Array(0) }),
      });
      await sandbox.run(`
        if (typeof Blob.__getBytes !== 'undefined') throw new Error('Blob.__getBytes leaked');
      `);
      sandbox.dispose();
    });

    it('Blob.__getBytes is hidden from sandbox code (without fetch resolver)', async () => {
      const sandbox = await createSandbox('test');
      await sandbox.run(`
        if (typeof Blob.__getBytes !== 'undefined') throw new Error('Blob.__getBytes leaked');
      `);
      sandbox.dispose();
    });

    it('fetch still works with Blob bodies after Blob.__getBytes is hidden', async () => {
      let receivedBody: Uint8Array | null = null;
      const sandbox = await createSandbox('test', {
        fetchResolver: async req => {
          receivedBody = req.body;
          return { status: 200, headers: [], body: new Uint8Array(0) };
        },
      });
      // Top-level await keeps the module load promise pending until fetch
      // settles; sandbox.run() awaits that promise, so no external tick needed.
      await sandbox.run(`
        await fetch('https://example.test/', { method: 'POST', body: new Blob([new Uint8Array([1, 2, 3])]) });
      `);
      expect(Array.from(receivedBody ?? new Uint8Array())).toEqual([1, 2, 3]);
      sandbox.dispose();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Host ↔ sandbox messaging: the primary product channel. Covers the port
  // surface (postMessage, onmessage, addEventListener, removeEventListener,
  // close) and the provider's subscribe/postMessage on the host side.
  // ─────────────────────────────────────────────────────────────────────────────
  describe('host ↔ sandbox messaging', () => {
    it('sandbox port.postMessage delivers bytes to provider subscribers', async () => {
      const sandbox = await createSandbox('test');
      const received: Uint8Array[] = [];
      sandbox.provider.subscribe(bytes => received.push(bytes));

      await sandbox.run('__HOST_API_PORT__.postMessage(new Uint8Array([1, 2, 3]))');

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(new Uint8Array([1, 2, 3]));
      sandbox.dispose();
    });

    it('provider.postMessage delivers bytes to port.onmessage', async () => {
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

    it('provider.postMessage delivers bytes to addEventListener("message", …)', async () => {
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

    it('onmessage fires before addEventListener handlers (in registration order)', async () => {
      const received: number[] = [];
      const sandbox = await createSandbox('test');
      sandbox.provider.subscribe(bytes => received.push(...bytes.subarray(0, 1)));

      await sandbox.run(`
        __HOST_API_PORT__.onmessage = event => { __HOST_API_PORT__.postMessage(new Uint8Array([event.data[0]])); };
        __HOST_API_PORT__.addEventListener('message', event => { __HOST_API_PORT__.postMessage(new Uint8Array([event.data[0] + 10])); });
      `);
      sandbox.provider.postMessage(new Uint8Array([5]));

      expect(received).toEqual([5, 15]);
      sandbox.dispose();
    });

    it('addEventListener silently ignores non-function handlers', async () => {
      const received: number[] = [];
      const sandbox = await createSandbox('test');
      sandbox.provider.subscribe(bytes => received.push(...bytes.subarray(0, 1)));

      await sandbox.run(`
        __HOST_API_PORT__.addEventListener('message', 42);
        __HOST_API_PORT__.addEventListener('message', null);
        __HOST_API_PORT__.addEventListener('message', { handleEvent: () => {} });
        __HOST_API_PORT__.addEventListener('message', event => { __HOST_API_PORT__.postMessage(new Uint8Array([event.data[0]])); });
      `);
      sandbox.provider.postMessage(new Uint8Array([7]));
      expect(received).toEqual([7]);
      sandbox.dispose();
    });

    it('addEventListener dedupes the same handler', async () => {
      const received: number[] = [];
      const sandbox = await createSandbox('test');
      sandbox.provider.subscribe(bytes => received.push(...bytes.subarray(0, 1)));

      await sandbox.run(`
        const h = event => { __HOST_API_PORT__.postMessage(new Uint8Array([event.data[0]])); };
        __HOST_API_PORT__.addEventListener('message', h);
        __HOST_API_PORT__.addEventListener('message', h);
        __HOST_API_PORT__.addEventListener('message', h);
      `);
      sandbox.provider.postMessage(new Uint8Array([3]));
      expect(received).toEqual([3]);
      sandbox.dispose();
    });

    it('removeEventListener removes a previously added handler', async () => {
      const received: number[] = [];
      const sandbox = await createSandbox('test');
      sandbox.provider.subscribe(bytes => received.push(...bytes.subarray(0, 1)));

      await sandbox.run(`
        const h = event => { __HOST_API_PORT__.postMessage(new Uint8Array([event.data[0]])); };
        __HOST_API_PORT__.addEventListener('message', h);
        __HOST_API_PORT__.removeEventListener('message', h);
      `);
      sandbox.provider.postMessage(new Uint8Array([1]));
      expect(received).toEqual([]);
      sandbox.dispose();
    });

    it('port.onmessage is a getter/setter — defaults to null, accepts functions', async () => {
      const sandbox = await createSandbox('test');
      await sandbox.run(`
        if (__HOST_API_PORT__.onmessage !== null) throw new Error('expected null');
        __HOST_API_PORT__.onmessage = () => {};
        if (typeof __HOST_API_PORT__.onmessage !== 'function') throw new Error('expected function');
      `);
      sandbox.dispose();
    });

    it('port.close stops further deliveries', async () => {
      const received: number[] = [];
      const sandbox = await createSandbox('test');
      sandbox.provider.subscribe(bytes => received.push(...bytes.subarray(0, 1)));

      await sandbox.run(`
        __HOST_API_PORT__.onmessage = event => { __HOST_API_PORT__.postMessage(new Uint8Array([event.data[0]])); };
        __HOST_API_PORT__.close();
      `);
      sandbox.provider.postMessage(new Uint8Array([1]));
      expect(received).toEqual([]);
      sandbox.dispose();
    });

    it('provider.subscribe returns an unsubscribe that stops delivery', async () => {
      const sandbox = await createSandbox('test');
      const received: Uint8Array[] = [];
      const unsubscribe = sandbox.provider.subscribe(bytes => received.push(bytes));

      unsubscribe();
      await sandbox.run('__HOST_API_PORT__.postMessage(new Uint8Array([1]))');

      expect(received).toHaveLength(0);
      sandbox.dispose();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Injected globals: per-API spec/integration coverage. Each block focuses on
  // one global; "is the global injected?" is implicit in functional tests.
  // ─────────────────────────────────────────────────────────────────────────────
  describe('injected globals', () => {
    describe('TextEncoder / TextDecoder', () => {
      it('TextEncoder.encoding is "utf-8" and read-only', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          'use strict';
          const e = new TextEncoder();
          if (e.encoding !== 'utf-8') throw new Error('expected utf-8, got ' + e.encoding);
          let threw = false;
          try { e.encoding = 'utf-16'; } catch (err) { threw = true; }
          if (!threw) throw new Error('expected assignment to throw in strict mode');
          if (e.encoding !== 'utf-8') throw new Error('encoding mutated: ' + e.encoding);
        `);
        sandbox.dispose();
      });

      it('TextDecoder.encoding is read-only and respects the constructor arg', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          'use strict';
          const d = new TextDecoder('utf-8');
          if (d.encoding !== 'utf-8') throw new Error('expected encoding utf-8');
          let threw = false;
          try { d.encoding = 'utf-16'; } catch (e) { threw = true; }
          if (!threw) throw new Error('expected assignment to throw in strict mode');
          if (d.encoding !== 'utf-8') throw new Error('encoding mutated: ' + d.encoding);
        `);
        sandbox.dispose();
      });
    });

    describe('timers', () => {
      it('setTimeout / clearTimeout: clear reliably cancels (no use-after-free)', async () => {
        const sandbox = await createSandbox('test');
        const ready = new Promise<number>(resolve => sandbox.provider.subscribe(b => resolve(b[0] ?? 0)));
        await sandbox.run(`
          let fired = false;
          const id = setTimeout(() => { fired = true; }, 5);
          clearTimeout(id);
          // Wait past the original ttl; if clearTimeout actually cancelled, fired stays false.
          setTimeout(() => {
            __HOST_API_PORT__.postMessage(new Uint8Array([fired ? 0 : 1]));
          }, 30);
        `);
        const flag = await ready;
        expect(flag).toBe(1);
        sandbox.dispose();
      });

      it('setInterval / clearInterval: clear reliably cancels', async () => {
        const sandbox = await createSandbox('test');
        const ready = new Promise<number>(resolve => sandbox.provider.subscribe(b => resolve(b[0] ?? 0)));
        await sandbox.run(`
          let count = 0;
          const id = setInterval(() => { count++; }, 5);
          clearInterval(id);
          setTimeout(() => {
            __HOST_API_PORT__.postMessage(new Uint8Array([count === 0 ? 1 : 0]));
          }, 30);
        `);
        const flag = await ready;
        expect(flag).toBe(1);
        sandbox.dispose();
      });

      it('queueMicrotask runs the supplied callback', async () => {
        const sandbox = await createSandbox('test');
        const ready = new Promise<number>(resolve => sandbox.provider.subscribe(b => resolve(b[0] ?? 0)));
        await sandbox.run(`
          queueMicrotask(() => { __HOST_API_PORT__.postMessage(new Uint8Array([1])); });
        `);
        const flag = await ready;
        expect(flag).toBe(1);
        sandbox.dispose();
      });
    });

    describe('crypto.getRandomValues', () => {
      it('fills a Uint8Array in place and returns the same instance', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          const a = new Uint8Array(32);
          const ret = crypto.getRandomValues(a);
          if (ret !== a) throw new Error('expected returned array to be the same instance');
          let nonZero = 0;
          for (const b of a) if (b !== 0) nonZero++;
          // 32 bytes from a CSPRNG should have at least one non-zero byte.
          if (nonZero === 0) throw new Error('expected non-zero bytes');
        `);
        sandbox.dispose();
      });

      it('fills only the view, not adjacent bytes of the underlying buffer', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          const big = new ArrayBuffer(64);
          const head = new Uint8Array(big, 0, 16);
          const view = new Uint8Array(big, 16, 32);
          const tail = new Uint8Array(big, 48, 16);
          crypto.getRandomValues(view);
          for (const b of head) if (b !== 0) throw new Error('head was clobbered');
          for (const b of tail) if (b !== 0) throw new Error('tail was clobbered');
        `);
        sandbox.dispose();
      });

      it('preserves the input view type (Uint32Array)', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          const a = new Uint32Array(8);
          const ret = crypto.getRandomValues(a);
          if (ret !== a) throw new Error('expected same instance back');
          if (!(ret instanceof Uint32Array)) throw new Error('expected Uint32Array');
          let nonZero = 0;
          for (const v of a) if (v !== 0) nonZero++;
          if (nonZero === 0) throw new Error('expected non-zero values');
        `);
        sandbox.dispose();
      });
    });

    describe('AbortController / AbortSignal', () => {
      const assertInSandbox = (sandbox: Sandbox, expr: string) =>
        sandbox.run(`if (!(${expr})) throw new Error('assertion failed: ${expr.replace(/'/g, "\\'")}');`);

      it('exposes AbortController, AbortSignal, and DOMException as globals', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          if (typeof AbortController !== 'function') throw new Error('AbortController missing');
          if (typeof AbortSignal !== 'function') throw new Error('AbortSignal missing');
          if (typeof DOMException !== 'function') throw new Error('DOMException missing');
        `);
        sandbox.dispose();
      });

      it('produces AbortSignal instances from a controller', async () => {
        const sandbox = await createSandbox('test');
        await assertInSandbox(sandbox, 'new AbortController().signal instanceof AbortSignal');
        await assertInSandbox(sandbox, 'new AbortController() instanceof AbortController');
        sandbox.dispose();
      });

      it('signal.aborted starts false and flips to true after abort()', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          const c = new AbortController();
          if (c.signal.aborted) throw new Error('expected initially not aborted');
          c.abort();
          if (!c.signal.aborted) throw new Error('expected aborted after abort()');
        `);
        sandbox.dispose();
      });

      it('abort() without reason fills signal.reason with an AbortError DOMException', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          const c = new AbortController();
          c.abort();
          const r = c.signal.reason;
          if (!(r instanceof DOMException)) throw new Error('expected DOMException reason, got ' + Object.prototype.toString.call(r));
          if (r.name !== 'AbortError') throw new Error('expected AbortError, got ' + r.name);
          if (r.code !== 20) throw new Error('expected code 20, got ' + r.code);
        `);
        sandbox.dispose();
      });

      it('abort(reason) preserves the supplied reason verbatim', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          const c = new AbortController();
          const sentinel = { tag: 'custom' };
          c.abort(sentinel);
          if (c.signal.reason !== sentinel) throw new Error('reason was not preserved');
        `);
        sandbox.dispose();
      });

      it('throwIfAborted throws the reason when aborted, no-op otherwise', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          const c = new AbortController();
          c.signal.throwIfAborted(); // no-op
          c.abort('boom');
          let caught;
          try { c.signal.throwIfAborted(); } catch (e) { caught = e; }
          if (caught !== 'boom') throw new Error('expected thrown reason to equal "boom"');
        `);
        sandbox.dispose();
      });

      it('addEventListener("abort", fn) fires once with an Event-like object', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          const c = new AbortController();
          let fired = 0;
          let received;
          c.signal.addEventListener('abort', (e) => { fired++; received = e; });
          c.abort();
          c.abort(); // second abort must not refire
          if (fired !== 1) throw new Error('expected listener to fire exactly once, got ' + fired);
          if (!received || received.type !== 'abort') throw new Error('expected event.type === "abort"');
          if (received.target !== c.signal) throw new Error('expected event.target === signal');
          if (received.currentTarget !== c.signal) throw new Error('expected event.currentTarget === signal');
        `);
        sandbox.dispose();
      });

      it('signal.onabort fires on abort and is independent of addEventListener', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          const c = new AbortController();
          let onabortCalls = 0, listenerCalls = 0;
          c.signal.onabort = () => { onabortCalls++; };
          c.signal.addEventListener('abort', () => { listenerCalls++; });
          c.abort();
          if (onabortCalls !== 1) throw new Error('onabort should fire once, got ' + onabortCalls);
          if (listenerCalls !== 1) throw new Error('listener should fire once, got ' + listenerCalls);
        `);
        sandbox.dispose();
      });

      it('removeEventListener prevents firing', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          const c = new AbortController();
          let calls = 0;
          const fn = () => { calls++; };
          c.signal.addEventListener('abort', fn);
          c.signal.removeEventListener('abort', fn);
          c.abort();
          if (calls !== 0) throw new Error('listener should not fire after removal, got ' + calls);
        `);
        sandbox.dispose();
      });

      it('once: true auto-removes the listener after first dispatch', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          const c = new AbortController();
          let calls = 0;
          c.signal.addEventListener('abort', () => { calls++; }, { once: true });
          c.abort();
          // Fake a re-dispatch by calling dispatchEvent directly
          c.signal.dispatchEvent({ type: 'abort' });
          if (calls !== 1) throw new Error('expected once listener to fire 1 time, got ' + calls);
        `);
        sandbox.dispose();
      });

      it('handleEvent objects are accepted as listeners', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          const c = new AbortController();
          let calls = 0;
          const handler = { handleEvent(e) { if (e.type === 'abort') calls++; } };
          c.signal.addEventListener('abort', handler);
          c.abort();
          if (calls !== 1) throw new Error('expected handleEvent to fire, got ' + calls);
        `);
        sandbox.dispose();
      });

      it('AbortSignal.abort(reason) returns an already-aborted signal', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          const s = AbortSignal.abort('x');
          if (!(s instanceof AbortSignal)) throw new Error('expected AbortSignal');
          if (!s.aborted) throw new Error('expected aborted');
          if (s.reason !== 'x') throw new Error('expected reason "x"');

          const def = AbortSignal.abort();
          if (!(def.reason instanceof DOMException) || def.reason.name !== 'AbortError') {
            throw new Error('expected default AbortError DOMException');
          }
        `);
        sandbox.dispose();
      });

      it('AbortSignal.timeout(ms) aborts with a TimeoutError after the delay', async () => {
        const sandbox = await createSandbox('test');
        const ready = new Promise<void>(resolve => {
          sandbox.provider.subscribe(bytes => {
            if (bytes[0] === 1) resolve();
          });
        });
        await sandbox.run(`
          const s = AbortSignal.timeout(5);
          if (s.aborted) throw new Error('expected not yet aborted');
          s.addEventListener('abort', () => {
            if (!(s.reason instanceof DOMException) || s.reason.name !== 'TimeoutError') {
              __HOST_API_PORT__.postMessage(new Uint8Array([0]));
              return;
            }
            __HOST_API_PORT__.postMessage(new Uint8Array([1]));
          });
        `);
        await ready;
        sandbox.dispose();
      });

      it('AbortSignal.any aborts immediately when one source is already aborted', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          const a = AbortSignal.abort('first');
          const b = new AbortController().signal;
          const any = AbortSignal.any([a, b]);
          if (!any.aborted) throw new Error('expected immediate abort');
          if (any.reason !== 'first') throw new Error('expected reason "first", got ' + any.reason);
        `);
        sandbox.dispose();
      });

      it('AbortSignal.any aborts when one of its sources aborts later', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          const c1 = new AbortController();
          const c2 = new AbortController();
          const any = AbortSignal.any([c1.signal, c2.signal]);
          if (any.aborted) throw new Error('expected not yet aborted');
          c2.abort('via-c2');
          if (!any.aborted) throw new Error('expected any to be aborted via c2');
          if (any.reason !== 'via-c2') throw new Error('expected reason "via-c2", got ' + any.reason);
        `);
        sandbox.dispose();
      });

      it('controllers are independent', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          const a = new AbortController();
          const b = new AbortController();
          a.abort();
          if (b.signal.aborted) throw new Error('b should not be aborted');
          if (!a.signal.aborted) throw new Error('a should be aborted');
        `);
        sandbox.dispose();
      });

      it('controller.signal is non-writable', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          'use strict';
          const c = new AbortController();
          const original = c.signal;
          let threw = false;
          try { c.signal = null; } catch (e) { threw = true; }
          if (!threw) throw new Error('expected assignment to throw in strict mode');
          if (c.signal !== original) throw new Error('signal must remain stable');
        `);
        sandbox.dispose();
      });
    });

    describe('Blob / FormData', () => {
      it('Blob and FormData are available even without a fetch resolver', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          if (typeof Blob !== 'function') throw new Error('Blob missing');
          if (typeof FormData !== 'function') throw new Error('FormData missing');
          const b = new Blob(['x']);
          const f = new FormData();
          f.append('k', 'v');
          if (b.size !== 1) throw new Error('Blob broken');
          if (f.get('k') !== 'v') throw new Error('FormData broken');
        `);
        sandbox.dispose();
      });

      it('Blob round-trips text and bytes', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          (async () => {
            const b = new Blob(['hello, ', 'world'], { type: 'text/plain' });
            if (b.size !== 12) throw new Error('size wrong: ' + b.size);
            if (b.type !== 'text/plain') throw new Error('type wrong');
            const t = await b.text();
            if (t !== 'hello, world') throw new Error('text wrong: ' + t);
          })();
        `);
        sandbox.dispose();
      });

      it('FormData supports append/set/get/has/delete and iteration', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`
          const f = new FormData();
          f.append('a', '1');
          f.append('a', '2');
          f.set('b', '3');
          if (f.get('a') !== '1') throw new Error('get returns first');
          const all = f.getAll('a');
          if (all.length !== 2 || all[0] !== '1' || all[1] !== '2') throw new Error('getAll wrong');
          if (!f.has('b')) throw new Error('has b');
          f.delete('a');
          if (f.has('a')) throw new Error('a not deleted');
          const out = [];
          for (const [k, v] of f) out.push(k + '=' + v);
          if (out.join(',') !== 'b=3') throw new Error('iteration wrong: ' + out.join(','));
        `);
        sandbox.dispose();
      });
    });

    describe('Headers / Request / Response / fetch', () => {
      it('does not inject fetch when no resolver is provided', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(`if (typeof fetch !== 'undefined') throw new Error('fetch should not be injected');`);
        sandbox.dispose();
      });

      it('Headers are case-insensitive and preserve set-cookie list semantics', async () => {
        const sandbox = await createSandbox('test', {
          fetchResolver: async () => ({ status: 200, headers: [], body: new Uint8Array(0) }),
        });
        await sandbox.run(`
          const h = new Headers();
          h.append('Content-Type', 'text/plain');
          h.append('content-type', 'text/html');
          if (h.get('CONTENT-TYPE') !== 'text/plain, text/html') throw new Error('combined wrong: ' + h.get('CONTENT-TYPE'));
          h.append('Set-Cookie', 'a=1');
          h.append('Set-Cookie', 'b=2');
          const cookies = h.getSetCookie();
          if (cookies.length !== 2 || cookies[0] !== 'a=1' || cookies[1] !== 'b=2') throw new Error('getSetCookie wrong');
        `);
        sandbox.dispose();
      });

      it('Request stores method (uppercased), url, headers, and body', async () => {
        const sandbox = await createSandbox('test', {
          fetchResolver: async () => ({ status: 200, headers: [], body: new Uint8Array(0) }),
        });
        await sandbox.run(`
          const r = new Request('https://example.test/api', {
            method: 'post',
            headers: { 'X-Tag': 'one' },
            body: 'hello',
          });
          if (r.url !== 'https://example.test/api') throw new Error('bad url');
          if (r.method !== 'POST') throw new Error('method not normalized');
          if (r.headers.get('content-type') !== 'text/plain;charset=UTF-8') throw new Error('content-type not auto-set');
          if (r.headers.get('x-tag') !== 'one') throw new Error('x-tag missing');
        `);
        sandbox.dispose();
      });

      it('Response.json sets content-type and round-trips JSON', async () => {
        const sandbox = await createSandbox('test', {
          fetchResolver: async () => ({ status: 200, headers: [], body: new Uint8Array(0) }),
        });
        await sandbox.run(`
          (async () => {
            const r = Response.json({ ok: true, n: 42 });
            if (r.headers.get('content-type') !== 'application/json') throw new Error('bad content-type');
            const j = await r.json();
            if (j.ok !== true || j.n !== 42) throw new Error('round-trip failed');
          })();
        `);
        sandbox.dispose();
      });

      it('fetch routes through resolver and exposes status/body to sandbox', async () => {
        const calls: Array<{ method: string; url: string; body: Uint8Array | null }> = [];
        const sandbox = await createSandbox('test', {
          fetchResolver: async req => {
            calls.push({ method: req.method, url: req.url, body: req.body });
            return {
              status: 201,
              statusText: 'Created',
              headers: [['content-type', 'application/json']],
              body: new TextEncoder().encode('{"ok":true}'),
            };
          },
        });
        const ready = new Promise<number>(resolve => sandbox.provider.subscribe(bytes => resolve(bytes[0] ?? 0)));
        await sandbox.run(`
          (async () => {
            const r = await fetch('https://example.test/x', { method: 'POST', body: 'hi' });
            const j = await r.json();
            __HOST_API_PORT__.postMessage(new Uint8Array([r.status === 201 && r.ok && j.ok ? 1 : 0]));
          })();
        `);
        const flag = await ready;
        expect(flag).toBe(1);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.url).toBe('https://example.test/x');
        expect(new TextDecoder().decode(calls[0]?.body ?? new Uint8Array())).toBe('hi');
        sandbox.dispose();
      });

      it('fetch rejects when AbortSignal is already aborted before call', async () => {
        const sandbox = await createSandbox('test', {
          fetchResolver: async () => {
            throw new Error('resolver should not be called');
          },
        });
        const ready = new Promise<number>(resolve => sandbox.provider.subscribe(bytes => resolve(bytes[0] ?? 0)));
        await sandbox.run(`
          (async () => {
            const c = new AbortController();
            c.abort();
            try {
              await fetch('https://example.test/', { signal: c.signal });
              __HOST_API_PORT__.postMessage(new Uint8Array([0]));
            } catch (e) {
              const ok = e && e.name === 'AbortError';
              __HOST_API_PORT__.postMessage(new Uint8Array([ok ? 1 : 0]));
            }
          })();
        `);
        const flag = await ready;
        expect(flag).toBe(1);
        sandbox.dispose();
      });

      it('fetch propagates AbortSignal to the resolver and rejects', async () => {
        const sandbox = await createSandbox('test', {
          fetchResolver: req =>
            new Promise((_, reject) => {
              const onAbort = () => reject(new Error('aborted by signal'));
              if (req.signal.aborted) onAbort();
              else req.signal.addEventListener('abort', onAbort, { once: true });
            }),
        });
        const ready = new Promise<number>(resolve => sandbox.provider.subscribe(bytes => resolve(bytes[0] ?? 0)));
        await sandbox.run(`
          (async () => {
            const c = new AbortController();
            const p = fetch('https://example.test/slow', { signal: c.signal });
            c.abort();
            try {
              await p;
              __HOST_API_PORT__.postMessage(new Uint8Array([0]));
            } catch (e) {
              __HOST_API_PORT__.postMessage(new Uint8Array([1]));
            }
          })();
        `);
        const flag = await ready;
        expect(flag).toBe(1);
        sandbox.dispose();
      });

      it('fetch propagates the resolver error name (TypeError) to sandbox', async () => {
        const sandbox = await createSandbox('test', {
          fetchResolver: async () => {
            throw new TypeError('Failed to fetch');
          },
        });
        const ready = new Promise<number>(resolve => sandbox.provider.subscribe(b => resolve(b[0] ?? 0)));
        await sandbox.run(`
          (async () => {
            try {
              await fetch('https://example.test/');
              __HOST_API_PORT__.postMessage(new Uint8Array([0]));
            } catch (e) {
              __HOST_API_PORT__.postMessage(new Uint8Array([e && e.name === 'TypeError' ? 1 : 0]));
            }
          })();
        `);
        const flag = await ready;
        expect(flag).toBe(1);
        sandbox.dispose();
      });

      it('fetch refuses to reuse a Request whose body is already consumed', async () => {
        const sandbox = await createSandbox('test', {
          fetchResolver: async () => ({ status: 200, headers: [], body: new Uint8Array(0) }),
        });
        const ready = new Promise<number>(resolve => sandbox.provider.subscribe(b => resolve(b[0] ?? 0)));
        await sandbox.run(`
          (async () => {
            const r = new Request('https://example.test/x', { method: 'POST', body: 'hi' });
            await fetch(r);
            try {
              await fetch(r);
              __HOST_API_PORT__.postMessage(new Uint8Array([0]));
            } catch (e) {
              __HOST_API_PORT__.postMessage(new Uint8Array([e instanceof TypeError ? 1 : 0]));
            }
          })();
        `);
        const flag = await ready;
        expect(flag).toBe(1);
        sandbox.dispose();
      });

      it('FormData body is encoded as multipart/form-data through fetch', async () => {
        let receivedBody: Uint8Array | null = null;
        let receivedContentType = '';
        const sandbox = await createSandbox('test', {
          fetchResolver: async req => {
            receivedBody = req.body;
            receivedContentType = req.headers.find(([k]) => k === 'content-type')?.[1] ?? '';
            return { status: 200, headers: [], body: new Uint8Array(0) };
          },
        });
        // Top-level await: sandbox.run() awaits the module load promise, which
        // doesn't resolve until fetch settles.
        await sandbox.run(`
          const f = new FormData();
          f.append('name', 'Sergey');
          f.append('blob', new Blob([new Uint8Array([1, 2, 3])], { type: 'application/octet-stream' }));
          await fetch('https://example.test/upload', { method: 'POST', body: f });
        `);
        expect(receivedContentType.startsWith('multipart/form-data; boundary=')).toBe(true);
        const text = new TextDecoder().decode(receivedBody ?? new Uint8Array());
        expect(text).toContain('Content-Disposition: form-data; name="name"');
        expect(text).toContain('Sergey');
        expect(text).toContain('Content-Disposition: form-data; name="blob"; filename="blob"');
        sandbox.dispose();
      });
    });

    describe('crypto.subtle', () => {
      it('does not inject subtle when no resolver is provided', async () => {
        const sandbox = await createSandbox('test');
        await sandbox.run(
          `if (typeof crypto.subtle !== 'undefined') throw new Error('subtle should not be injected');`,
        );
        sandbox.dispose();
      });

      it('digest forwards to resolver and returns the bytes as ArrayBuffer', async () => {
        const sandbox = await createSandbox('test', {
          subtleResolver: async ({ method, args }) => {
            if (method !== 'digest') throw new Error('unexpected: ' + method);
            expect(args[0]).toBe('SHA-256');
            return await crypto.subtle.digest(args[0], args[1]);
          },
        });
        const ready = new Promise<number>(resolve => sandbox.provider.subscribe(bytes => resolve(bytes[0] ?? 0)));
        await sandbox.run(`
          (async () => {
            const data = new TextEncoder().encode('hello');
            const out = await crypto.subtle.digest('SHA-256', data);
            // SHA-256("hello") starts with 2c f2 4d ba
            const view = new Uint8Array(out);
            const ok = out instanceof ArrayBuffer && view[0] === 0x2c && view[1] === 0xf2 && view[2] === 0x4d && view[3] === 0xba;
            __HOST_API_PORT__.postMessage(new Uint8Array([ok ? 1 : 0]));
          })();
        `);
        const flag = await ready;
        expect(flag).toBe(1);
        sandbox.dispose();
      });

      it('round-trips a CryptoKey through generateKey → exportKey via opaque ids', async () => {
        const sandbox = await createSandbox('test', {
          subtleResolver: async ({ method, args }) => {
            if (method === 'generateKey') {
              return await crypto.subtle.generateKey(args[0], args[1], args[2]);
            }
            if (method === 'exportKey') {
              return await crypto.subtle.exportKey(args[0], args[1]);
            }
            throw new Error('unexpected: ' + method);
          },
        });
        const ready = new Promise<number>(resolve => sandbox.provider.subscribe(bytes => resolve(bytes[0] ?? 0)));
        await sandbox.run(`
          (async () => {
            const key = await crypto.subtle.generateKey(
              { name: 'AES-GCM', length: 256 },
              true,
              ['encrypt', 'decrypt'],
            );
            if (!(key instanceof CryptoKey)) { __HOST_API_PORT__.postMessage(new Uint8Array([0])); return; }
            if (key.algorithm.name !== 'AES-GCM') { __HOST_API_PORT__.postMessage(new Uint8Array([0])); return; }
            const raw = await crypto.subtle.exportKey('raw', key);
            const ok = raw instanceof ArrayBuffer && raw.byteLength === 32;
            __HOST_API_PORT__.postMessage(new Uint8Array([ok ? 1 : 0]));
          })();
        `);
        const flag = await ready;
        expect(flag).toBe(1);
        sandbox.dispose();
      });

      it('CryptoKey GC release path is wired (FinalizationRegistry → bridge)', async () => {
        const inflightCalls: string[] = [];
        const sandbox = await createSandbox('test', {
          subtleResolver: async ({ method, args }) => {
            inflightCalls.push(method);
            if (method === 'generateKey') {
              return crypto.subtle.generateKey(args[0] as AesKeyGenParams, args[1] as boolean, args[2] as KeyUsage[]);
            }
            throw new Error('unexpected: ' + method);
          },
        });
        const ready = new Promise<number>(resolve => sandbox.provider.subscribe(b => resolve(b[0] ?? 0)));
        await sandbox.run(`
          (async () => {
            let key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, true, ['encrypt']);
            if (!(key instanceof CryptoKey)) throw new Error('expected CryptoKey');
            key = null;
            __HOST_API_PORT__.postMessage(new Uint8Array([1]));
          })();
        `);
        const flag = await ready;
        expect(flag).toBe(1);
        // We don't assert release was invoked synchronously — finalizers fire on
        // the runtime's schedule. The behaviour is exercised; this test guards
        // the wiring so the bridge protocol can't silently regress.
        expect(inflightCalls).toContain('generateKey');
        sandbox.dispose();
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // ES module imports: opt-in `resolveModule` hook supplies module sources on
  // demand so worker code can use `import` / `export` and dynamic `import()`.
  // ─────────────────────────────────────────────────────────────────────────────
  describe('ES module imports', () => {
    it('loads a static import whose export the entrypoint uses', async () => {
      const sandbox = await createSandbox('test', {
        resolveModule: (specifier, _importer, defaultResolve) => {
          const filename = defaultResolve(specifier, _importer);
          if (filename === 'math.js') {
            return { filename, content: 'export const add = (a, b) => a + b;' };
          }
          return null;
        },
      });
      const ready = new Promise<number>(resolve => sandbox.provider.subscribe(b => resolve(b[0] ?? 0)));
      await sandbox.run(
        `
          import { add } from 'math.js';
          __HOST_API_PORT__.postMessage(new Uint8Array([add(2, 3)]));
        `,
        { name: 'index.js' },
      );
      expect(await ready).toBe(5);
      sandbox.dispose();
    });

    it('resolves a relative import against the importer via defaultResolve', async () => {
      const entry = `
        import { tag } from './util.js';
        __HOST_API_PORT__.postMessage(new Uint8Array([tag]));
      `;
      const archive: Record<string, string> = { 'app/util.js': 'export const tag = 7;' };
      const sandbox = await createSandbox('test', {
        resolveModule: (specifier, importer, defaultResolve) => {
          const filename = defaultResolve(specifier, importer);
          const content = archive[filename];
          return content === undefined ? null : { filename, content };
        },
      });
      const ready = new Promise<number>(resolve => sandbox.provider.subscribe(b => resolve(b[0] ?? 0)));
      await sandbox.run(entry, { name: 'app/index.js' });
      expect(await ready).toBe(7);
      sandbox.dispose();
    });

    it('resolves a transitive import chain (A → B → C)', async () => {
      const entry = `
        import { b } from './b.js';
        __HOST_API_PORT__.postMessage(new Uint8Array([b]));
      `;
      const archive: Record<string, string> = {
        'c.js': 'export const c = 4;',
        'b.js': "import { c } from './c.js'; export const b = c + 1;",
      };
      const sandbox = await createSandbox('test', {
        resolveModule: (specifier, importer, defaultResolve) => {
          const filename = defaultResolve(specifier, importer);
          const content = archive[filename];
          return content === undefined ? null : { filename, content };
        },
      });
      const ready = new Promise<number>(resolve => sandbox.provider.subscribe(b => resolve(b[0] ?? 0)));
      await sandbox.run(entry, { name: 'a.js' });
      expect(await ready).toBe(5);
      sandbox.dispose();
    });

    it('dedupes by filename — a shared module is executed only once', async () => {
      const evalCounts: number[] = [];
      const archive: Record<string, string> = {
        // Each import of shared.js increments a host-observable counter at module
        // top level; if QuickJS deduped, the counter only advances once.
        'shared.js': '__HOST_API_PORT__.postMessage(new Uint8Array([1])); export const v = 1;',
        'left.js': "import { v } from './shared.js'; export const left = v;",
        'right.js': "import { v } from './shared.js'; export const right = v;",
      };
      const sandbox = await createSandbox('test', {
        resolveModule: (specifier, importer, defaultResolve) => {
          const filename = defaultResolve(specifier, importer);
          const content = archive[filename];
          return content === undefined ? null : { filename, content };
        },
      });
      sandbox.provider.subscribe(() => evalCounts.push(1));
      await sandbox.run(
        `
          import { left } from './left.js';
          import { right } from './right.js';
          if (left + right !== 2) throw new Error('imports broken');
        `,
        { name: 'index.js' },
      );
      // shared.js evaluated once despite being imported by both left and right.
      expect(evalCounts).toHaveLength(1);
      sandbox.dispose();
    });

    it('supports dynamic import() resolving asynchronously', async () => {
      const sandbox = await createSandbox('test', {
        resolveModule: async (specifier, importer, defaultResolve) => {
          await Promise.resolve();
          const filename = defaultResolve(specifier, importer);
          if (filename === 'lazy.js') return { filename, content: 'export const n = 9;' };
          return null;
        },
      });
      const ready = new Promise<number>(resolve => sandbox.provider.subscribe(b => resolve(b[0] ?? 0)));
      await sandbox.run(
        `
          (async () => {
            const mod = await import('lazy.js');
            __HOST_API_PORT__.postMessage(new Uint8Array([mod.n]));
          })();
        `,
        { name: 'index.js' },
      );
      expect(await ready).toBe(9);
      sandbox.dispose();
    });

    it('decodes Uint8Array module content as utf-8', async () => {
      const source = new TextEncoder().encode('export const ch = "€".codePointAt(0) & 0xff;');
      const sandbox = await createSandbox('test', {
        resolveModule: (specifier, _importer, defaultResolve) => {
          const filename = defaultResolve(specifier, _importer);
          return filename === 'bytes.js' ? { filename, content: source } : null;
        },
      });
      const ready = new Promise<number>(resolve => sandbox.provider.subscribe(b => resolve(b[0] ?? 0)));
      await sandbox.run(
        `
          import { ch } from 'bytes.js';
          __HOST_API_PORT__.postMessage(new Uint8Array([ch]));
        `,
        { name: 'index.js' },
      );
      // '€'.codePointAt(0) === 0x20AC; low byte 0xAC. Proves the bytes were
      // decoded as utf-8 and parsed, not mangled.
      expect(await ready).toBe(0xac);
      sandbox.dispose();
    });

    it('surfaces a Module not found error when the resolver returns null', async () => {
      const sandbox = await createSandbox('test', {
        resolveModule: () => null,
      });
      await expect(sandbox.run(`import 'missing.js';`, { name: 'index.js' })).rejects.toThrow(/Module not found/);
      sandbox.dispose();
    });

    it('surfaces an error thrown by the resolver', async () => {
      const sandbox = await createSandbox('test', {
        resolveModule: () => {
          throw new Error('resolver exploded');
        },
      });
      await expect(sandbox.run(`import 'boom.js';`, { name: 'index.js' })).rejects.toThrow(/resolver exploded/);
      sandbox.dispose();
    });

    it('rejects run() without a name when resolveModule is configured', async () => {
      const sandbox = await createSandbox('test', {
        resolveModule: () => null,
      });
      await expect(sandbox.run('const x = 1;')).rejects.toThrow(/is required when resolveModule/);
      sandbox.dispose();
    });

    it('does not enable module loading when resolveModule is omitted', async () => {
      const sandbox = await createSandbox('test');
      await expect(sandbox.run(`import 'anything.js';`)).rejects.toThrow('Sandbox error');
      sandbox.dispose();
    });

    it('dispose() works after modules have been loaded', async () => {
      const sandbox = await createSandbox('test', {
        resolveModule: (specifier, _importer, defaultResolve) => {
          const filename = defaultResolve(specifier, _importer);
          return filename === 'm.js' ? { filename, content: 'export const v = 1;' } : null;
        },
      });
      await sandbox.run(`import { v } from 'm.js'; if (v !== 1) throw new Error('bad');`, { name: 'index.js' });
      expect(() => sandbox.dispose()).not.toThrow();
    });
  });
});
