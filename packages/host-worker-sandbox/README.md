# @novasamatech/host-worker-sandbox

QuickJS-based sandbox for running product "worker" code in an isolated VM, wired to Triangle Host API via a byte-oriented `Provider`.

## Usage

`createSandbox()` returns a `Sandbox` with `container` (a [`Container`](https://github.com/paritytech/triangle-js-sdks/tree/main/packages/host-container) from `@novasamatech/host-container`) and `provider`. Register `handle*` callbacks on `sandbox.container` so worker code that talks to the Host API receives real responses.

```ts
import { createSandbox } from '@novasamatech/host-worker-sandbox';

const hostStorage = new Map<string, Uint8Array>();

const sandbox = await createSandbox('worker.example-product.dot');

// Container bindings: implement the host side of the Host API (storage, features, chain, …).
const unbindStorageRead = sandbox.container.handleLocalStorageRead((key, { ok }) =>
  ok(hostStorage.get(key) ?? new Uint8Array()),
);
const unbindFeatureSupported = sandbox.container.handleFeatureSupported((_params, { ok }) => ok(false));

const workerSource = `
  // Worker module: __HOST_API_PORT__, TextEncoder, etc. are available in the VM.
`;

await sandbox.run(workerSource);

// Later on...

unbindStorageRead();
unbindFeatureSupported();
sandbox.dispose();
```

## Web API Support

The QuickJS VM does not include browser or Node.js globals. The following Web APIs are injected manually so worker code can rely on them.

### `console`

`console.log`, `console.info`, `console.warn`, and `console.error` are forwarded to the `Logger` instance passed to the sandbox. All other `console` methods are not available.

### `crypto`

`crypto.getRandomValues(typedArray)` is supported. It delegates to the host environment's `crypto.getRandomValues`. No other `SubtleCrypto` methods are available.

### `TextEncoder` / `TextDecoder`

`TextEncoder` supports `encode(string): Uint8Array`.

`TextDecoder` supports `decode(buffer)` where `buffer` can be a `TypedArray` (e.g. `Uint8Array`) or a raw `ArrayBuffer`. The optional encoding label passed to the constructor is respected (defaults to `utf-8`). The `encoding` property is available on instances. Streaming decode (`decode(chunk, { stream: true })`) is not supported.

### Timers

`setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, and `queueMicrotask` are all supported. They delegate to the host environment's timer APIs. No `setImmediate` or `requestAnimationFrame` is available.

### `AbortController`

`AbortController` is fully functional. `controller.abort()` sets `signal.aborted` to `true` and synchronously fires all `'abort'` listeners registered via `signal.addEventListener('abort', handler)`. `signal.removeEventListener('abort', handler)` works by function identity. If `addEventListener` is called after the signal is already aborted, the handler fires immediately. Only the `'abort'` event type is supported.
