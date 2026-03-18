# @novasamatech/worker-sandbox

QuickJS-based sandbox for running product "worker" code in an isolated VM, wired to Triangle Host API via a byte-oriented `Provider`.

## Usage

```ts
import { createSandbox } from '@novasamatech/worker-sandbox';

const sandbox = await createSandbox();
await sandbox.run(code, 'product-id');
sandbox.dispose();
```

