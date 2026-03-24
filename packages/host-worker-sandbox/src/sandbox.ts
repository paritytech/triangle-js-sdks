import type { Provider } from '@novasamatech/host-api';
import { createDefaultLogger } from '@novasamatech/host-api';
import type { Container } from '@novasamatech/host-container';
import { createContainer } from '@novasamatech/host-container';
import type { QuickJSContext, QuickJSHandle, VmPropertyDescriptor } from 'quickjs-emscripten';
import { getQuickJS } from 'quickjs-emscripten';

import { injectAbortController } from './globals/AbortController.js';
import { injectTextDecoder } from './globals/TextDecoder.js';
import { injectTextEncoder } from './globals/TextEncoder.js';
import { injectConsole } from './globals/console.js';
import { injectCrypto } from './globals/crypto.js';
import { injectIntervals, injectQueueMicrotask, injectTimeouts } from './globals/timers.js';

export type Sandbox = {
  container: Container;
  provider: Provider;
  run: (code: string | Uint8Array, product?: string) => Promise<void>;
  dispose: VoidFunction;
};

// Shared mutable state for the onmessage property descriptor.
// Extracted as a plain object so it can be captured in function expressions
// without aliasing `this` (which is banned by @typescript-eslint/no-this-alias).
type OnMessageState = { handle: QuickJSHandle | null };

function makeOnMessageDescriptor(state: OnMessageState, vm: QuickJSContext): VmPropertyDescriptor<QuickJSHandle> {
  // Regular function expressions have implicit `this: any`, which satisfies
  // `(this: QuickJSHandle) => QuickJSHandle` without needing an `as` cast.
  return {
    configurable: false,
    enumerable: true,
    get() {
      return state.handle?.dup() ?? vm.null;
    },
    set(handlerHandle: QuickJSHandle) {
      state.handle?.dispose();
      const value = vm.dump(handlerHandle);
      state.handle = value == null ? null : handlerHandle.dup();
    },
  };
}

class SandboxPort {
  private readonly vm: QuickJSContext;
  private readonly onMessageState: OnMessageState = { handle: null };
  private readonly messageListeners: QuickJSHandle[] = [];
  private readonly subscribers = new Set<(message: Uint8Array) => void>();
  private readonly toUint8ArrayFn: QuickJSHandle;
  private disposed = false;
  readonly provider: Provider;

  constructor(productId: string, vm: QuickJSContext, toUint8ArrayFn: QuickJSHandle) {
    this.vm = vm;
    this.toUint8ArrayFn = toUint8ArrayFn;
    this.provider = this.makeProvider(productId);
  }

  buildHandle(): QuickJSHandle {
    const { vm } = this;
    const port = vm.newObject();

    // sandbox → host: extract Uint8Array bytes from the QuickJS handle and notify subscribers
    const postMessageFn = vm.newFunction('postMessage', dataHandle => {
      try {
        const bufferHandle = vm.getProp(dataHandle, 'buffer');
        const byteOffsetHandle = vm.getProp(dataHandle, 'byteOffset');
        const byteLengthHandle = vm.getProp(dataHandle, 'byteLength');

        const lifetime = vm.getArrayBuffer(bufferHandle);
        // Number() converts `unknown` to number without an `as` cast
        const byteOffset = Number(vm.dump(byteOffsetHandle));
        const byteLength = Number(vm.dump(byteLengthHandle));

        bufferHandle.dispose();
        byteOffsetHandle.dispose();
        byteLengthHandle.dispose();

        // .slice() copies out of WASM memory before the lifetime is freed
        const bytes = lifetime.value.slice(byteOffset, byteOffset + byteLength);
        lifetime.dispose();

        for (const subscriber of this.subscribers) {
          subscriber(bytes);
        }
      } catch (e) {
        console.error('[Sandbox] port.postMessage: failed to extract bytes', e);
      }
    });
    vm.setProp(port, 'postMessage', postMessageFn);
    postMessageFn.dispose();

    // host → sandbox via addEventListener('message', handler)
    const addEventListenerFn = vm.newFunction('addEventListener', (typeHandle, handlerHandle) => {
      if (vm.getString(typeHandle) === 'message') {
        this.messageListeners.push(handlerHandle.dup());
      }
    });
    vm.setProp(port, 'addEventListener', addEventListenerFn);
    addEventListenerFn.dispose();

    // start() — no-op, exists for API compatibility
    const startFn = vm.newFunction('start', () => vm.undefined);
    vm.setProp(port, 'start', startFn);
    startFn.dispose();

    // close() — frees all stored handles
    const closeFn = vm.newFunction('close', () => {
      this.disposeHandles();
    });
    vm.setProp(port, 'close', closeFn);
    closeFn.dispose();

    // onmessage getter/setter via defineProp.
    // State is accessed through a plain object ref captured in function expressions.
    const { onMessageState } = this;
    vm.defineProp(port, 'onmessage', makeOnMessageDescriptor(onMessageState, vm));

    return port;
  }

  // Returns a Provider implementation backed by this port's QuickJS transport
  private makeProvider(productId: string): Provider {
    return {
      logger: createDefaultLogger(productId),
      isCorrectEnvironment: () => true,
      postMessage: message => {
        this.deliver(message);
      },
      subscribe: callback => {
        this.subscribers.add(callback);
        return () => {
          this.subscribers.delete(callback);
        };
      },
      dispose: () => undefined,
    };
  }

  // Delivers raw bytes from the host into the sandbox as a MessageEvent with Uint8Array data
  private deliver(bytes: Uint8Array): void {
    if (this.disposed) return;
    const { vm } = this;

    // Ensure the ArrayBuffer exactly covers the bytes (handle slice views)
    const buffer =
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer
        : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    const bufferHandle = vm.newArrayBuffer(buffer);
    const uint8Result = vm.callFunction(this.toUint8ArrayFn, vm.undefined, bufferHandle);
    bufferHandle.dispose();

    if (uint8Result.error) {
      console.error('[Sandbox] port: failed to create Uint8Array', vm.dump(uint8Result.error));
      uint8Result.error.dispose();
      return;
    }

    const event = vm.newObject();
    vm.setProp(event, 'data', uint8Result.value);
    uint8Result.value.dispose();

    const handlers: QuickJSHandle[] = [];
    if (this.onMessageState.handle) handlers.push(this.onMessageState.handle);
    handlers.push(...this.messageListeners);

    for (const handler of handlers) {
      const result = vm.callFunction(handler, vm.undefined, event);
      if (result.error) {
        console.error('[Sandbox] port.onmessage error:', vm.dump(result.error));
        result.error.dispose();
      } else {
        result.value.dispose();
      }
    }

    event.dispose();

    const jobResult = vm.runtime.executePendingJobs(-1);
    if (jobResult.error) {
      console.error('[Sandbox] job error after port message:', vm.dump(jobResult.error));
      jobResult.error.dispose();
    }
  }

  private disposeHandles(): void {
    this.onMessageState.handle?.dispose();
    this.onMessageState.handle = null;
    for (const h of this.messageListeners) h.dispose();
    this.messageListeners.length = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.disposeHandles();
    this.subscribers.clear();
  }
}

class QuickJsSandbox implements Sandbox {
  private readonly vm: QuickJSContext;
  private readonly port: SandboxPort;
  private readonly toUint8ArrayFn: QuickJSHandle;
  private readonly disposeTimers: VoidFunction;
  private disposed = false;

  readonly productId: string;
  readonly container: Container;
  readonly provider: Provider;

  constructor(productId: string, vm: QuickJSContext) {
    this.productId = productId;
    this.vm = vm;

    const helperResult = vm.evalCode('(buf) => new Uint8Array(buf)');
    if (helperResult.error) {
      const msg = vm.dump(helperResult.error);
      helperResult.error.dispose();
      throw new Error(`Sandbox setup error: ${JSON.stringify(msg)}`);
    }
    this.toUint8ArrayFn = helperResult.value;
    this.port = new SandboxPort(productId, vm, this.toUint8ArrayFn);
    this.provider = this.port.provider;
    this.container = createContainer(this.provider);

    this.disposeTimers = this.injectGlobals();
  }

  private injectGlobals(): VoidFunction {
    const { vm } = this;

    const portHandle = this.port.buildHandle();
    vm.setProp(vm.global, '__HOST_WEBVIEW_MARK__', vm.true);
    vm.setProp(vm.global, '__HOST_API_PORT__', portHandle);
    portHandle.dispose();

    vm.setProp(vm.global, 'top', vm.global);
    vm.setProp(vm.global, 'window', vm.global);

    injectConsole(vm, this.provider.logger);
    injectTextEncoder(vm, this.toUint8ArrayFn);
    injectTextDecoder(vm);
    injectCrypto(vm, this.toUint8ArrayFn);
    injectAbortController(vm);
    const disposeQueueMicrotask = injectQueueMicrotask(vm);
    const disposeIntervals = injectIntervals(vm);
    const disposeTimeouts = injectTimeouts(vm);

    return () => {
      disposeTimeouts();
      disposeIntervals();
      disposeQueueMicrotask();
    };
  }

  async run(code: string | Uint8Array): Promise<void> {
    const { vm } = this;
    const str = typeof code === 'string' ? code : new TextDecoder().decode(code);
    const result = vm.evalCode(str, `${this.productId ?? 'unknown_product'}/worker.js`, {
      type: 'module',
      strict: true,
    });

    if (result.error) {
      const message = vm.dump(result.error);
      result.error.dispose();
      throw new Error(`Sandbox error: ${JSON.stringify(message)}`);
    }

    // If the evaluated code returned a Promise (e.g. an async IIFE), attach a
    // .then and .catch handler before flushing microtasks so that rejections are surfaced
    // as thrown errors rather than silently swallowed.

    let response: Promise<void> | undefined = undefined;

    const thenHandle = vm.getProp(result.value, 'then');
    if (vm.typeof(thenHandle) === 'function') {
      response = new Promise<void>((resolve, reject) => {
        const thenFn = vm.newFunction('__then', () => {
          resolve();
        });
        const thenMethod = vm.getProp(result.value, 'then');
        const thenChained = vm.callFunction(thenMethod, result.value, thenFn);
        thenMethod.dispose();
        thenFn.dispose();
        if (thenChained.error) {
          thenChained.error.dispose();
        } else {
          thenChained.value.dispose();
        }

        const catchFn = vm.newFunction('__catch', errorHandle => {
          reject(new Error(`Sandbox error: ${JSON.stringify(vm.dump(errorHandle))}`));
        });
        const catchMethod = vm.getProp(result.value, 'catch');
        const cacheChained = vm.callFunction(catchMethod, result.value, catchFn);
        catchMethod.dispose();
        catchFn.dispose();
        if (cacheChained.error) {
          cacheChained.error.dispose();
        } else {
          cacheChained.value.dispose();
        }
      });
    }

    thenHandle.dispose();
    result.value.dispose();

    this.flushJobs();

    if (response) {
      await response;
    }
  }

  private flushJobs(): void {
    const result = this.vm.runtime.executePendingJobs(-1);
    if (result.error) {
      console.error('[Sandbox] job error:', this.vm.dump(result.error));
      result.error.dispose();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    const { vm } = this;

    this.disposeTimers();
    this.port.dispose();
    this.toUint8ArrayFn.dispose();

    vm.runtime.executePendingJobs(-1);
    vm.dispose();
  }
}

export async function createSandbox(productId: string): Promise<Sandbox> {
  const QuickJS = await getQuickJS();
  const vm = QuickJS.newContext();
  return new QuickJsSandbox(productId, vm);
}
