# @novasamatech/storage-adapter

Key-value storage abstraction shared by the SDK packages.

## Overview

`StorageAdapter` is a small async string key-value interface (`read`, `write`, `clear`, `subscribe`). The package ships
two implementations and two typed views over a single key:

- `createLocalStorageAdapter(prefix)` — backed by `localStorage`, keys namespaced by `prefix`;
- `createMemoryAdapter()` — in-memory, for tests and non-browser environments;
- `fieldView`, `fieldListView` — typed read/write access to one key with custom (de)serialization.

## Installation

```shell
npm install @novasamatech/storage-adapter --save -E
```
