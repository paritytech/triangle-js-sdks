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
