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

## ES Module Imports

By default, `import` declarations in worker code fail at load time. To enable ES
modules (static `import` / `export` and dynamic `import()`), pass a
`resolveModule` hook. It is called for every import the VM encounters and
returns the module's source on demand:

```ts
type ResolvedModule = { filename: string; content: string | Uint8Array };

type ModuleResolver = (
  specifier: string,
  importer: string | null,
  defaultResolve: (specifier: string, importer: string | null) => string,
) => Promise<ResolvedModule | null> | ResolvedModule | null;
```

- `importer` is the resolved `filename` of the module issuing the import, or
  `null` for the entrypoint's own imports.
- The resolver chooses each module's canonical `filename`. Returning the **same
  `filename`** for two imports makes them share a single module instance
  (dedup — the module executes once).
- `content` may be a `string` or a `Uint8Array` (decoded as UTF-8).
- Return `null` to signal "not found" (the import fails with
  `Module not found: …`). Throwing or rejecting surfaces that error to the import.
- `defaultResolve` POSIX-joins a relative specifier (`./x`, `../x`) against the
  importer's directory; bare specifiers pass through unchanged. The common case
  is `(specifier, importer, defaultResolve) => archive[defaultResolve(specifier, importer)]`.

When `resolveModule` is configured, `run()` requires a `name` identifying the
entrypoint so its relative imports can resolve against it:

```ts
const archive: Record<string, string> = {
  'app/util.js': 'export const tag = 7;',
  'app/index.js': `
    import { tag } from './util.js';
    __HOST_API_PORT__.postMessage(new Uint8Array([tag]));
  `,
};

const sandbox = await createSandbox('example-product.dot', {
  resolveModule: (specifier, importer, defaultResolve) => {
    const filename = defaultResolve(specifier, importer);
    const content = archive[filename];
    return content === undefined ? null : { filename, content };
  },
});

await sandbox.run(archive['app/index.js'], { name: 'app/index.js' });
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
