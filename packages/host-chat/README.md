# @novasamatech/host-chat

Account lookup and chat-message codecs for host applications integrating with the Polkadot People chain.

## Overview

`@novasamatech/host-chat` exposes the read side of the chat domain: discovering Polkadot
accounts by username and resolving their on-chain identity from `Resources.Consumers`. It
also publishes the SCALE codecs used by the chat wire protocol (messages, attachments,
local-message envelopes) so host applications can decode statements they receive over the
statement store.

The package is UI-framework agnostic. The main entry point returns plain async functions
backed by [`neverthrow`](https://github.com/supermacro/neverthrow) `ResultAsync`, and the
codec exports are pure SCALE codecs with no runtime side effects.

## Installation

```shell
npm install @novasamatech/host-chat --save -E
```

## Getting started

```ts
import { createAccountService } from '@novasamatech/host-chat';
import { createLazyClient } from '@novasamatech/statement-store';

const lazyClient = createLazyClient(/* chain provider */);
const accounts = createAccountService('paseo-next-v2', lazyClient);

// Search the off-chain username index for accounts whose username starts with `alice`.
const search = await accounts.search('alice', 'ASSIGNED');
if (search.isOk()) {
  for (const hit of search.value) {
    console.log(hit.candidateAccountId, hit.username);
  }
}

// Resolve a specific account's on-chain identity.
const identity = await accounts.getConsumerInfo('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY');
if (identity.isOk() && identity.value) {
  console.log(identity.value.fullUsername, identity.value.credibility);
}
```

### Networks

`createAccountService` accepts one of:

| Network          | People chain endpoint                  |
| ---------------- | -------------------------------------- |
| `stable`         | Polkadot People                        |
| `preview`        | Westend People                         |
| `paseo-next`     | Paseo People (V1)                      |
| `paseo-next-v2`  | Paseo People (V2 multi-device)         |

Each network entry pins both the People chain WebSocket URL (used via `lazyClient`) and
the off-chain identity-backend REST endpoint that `search` queries.

## API

### `createAccountService(network, lazyClient)`

Returns an object with two methods:

- **`search(query, status)`** — query the off-chain username index. `status` is
  `'ASSIGNED' | 'PENDING'`. Resolves to a list of `{ candidateAccountId, username, status,
  onchainData, createdAt, updatedAt }` rows.
- **`getConsumerInfo(address)`** — resolve a single SS58 address to an `Identity`
  (`{ accountId, fullUsername, liteUsername, credibility }`) by reading
  `Resources.Consumers` from the People chain. Returns `null` if the account has no
  consumer entry. Tolerates both snake_case (V1) and camelCase (V2) runtime field names.

Both methods return `ResultAsync<…, Error>`; call `.isOk()` / `.isErr()` to discriminate.

## Codec subpath exports

The chat wire codecs are exposed under explicit subpaths so they can be tree-shaken
independently of the main entry point:

```ts
import {
  ChatMessage,
  TextContent,
  RichTextContent,
  ChatAcceptedContent,
  DeviceAddedContent,
  DeviceRemovedContent,
} from '@novasamatech/host-chat/codec/message';

import {
  FileMeta,
  FileVariant,
  P2PMixnetFile,
} from '@novasamatech/host-chat/codec/attachment';

import type { ChatSession } from '@novasamatech/host-chat/session';
```

These are byte-compatible with the Android / iOS Polkadot Mobile clients — modify with
care, the indices are pinned by the protocol.
