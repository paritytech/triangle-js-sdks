# @novasamatech/host-chat

Account lookup and chat-message codecs for host applications integrating with the Polkadot People chain.

## Overview

`@novasamatech/host-chat` exposes the read side of the chat domain: discovering Polkadot accounts by username and
resolving their on-chain identity from `Resources.Consumers`. It also publishes the SCALE codecs used by the chat wire
protocol (messages, attachments, local-message envelopes) so host applications can decode statements they receive over
the statement store.

The package is UI-framework agnostic. The main entry point returns plain async functions backed by
[`neverthrow`](https://github.com/supermacro/neverthrow) `ResultAsync`, and the codec exports are pure SCALE codecs with
no runtime side effects.

## Installation

```shell
npm install @novasamatech/host-chat --save -E
```

## Getting started

```ts
import { createAccountService } from '@novasamatech/host-chat';
import { createIdentityRepository, createIdentityRpcAdapter } from '@novasamatech/host-papp';
import { createLocalStorageAdapter } from '@novasamatech/storage-adapter';
import { createLazyClient } from '@novasamatech/statement-store';

const lazyClient = createLazyClient(/* chain provider */);
const accounts = createAccountService({
  identityEndpoint: 'https://identity-backend.example/',
  identity: createIdentityRepository({
    adapter: createIdentityRpcAdapter(lazyClient),
    storage: createLocalStorageAdapter('my-host-app'),
  }),
});

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

  // 32-byte X25519 chat encryption key as hex, or null for a keypair type
  // this SDK does not implement.
  console.log(identity.value.identifierKey);
}
```

## API

### `createAccountService({ identityEndpoint, identity })`

- **`identityEndpoint`** — base URL of the off-chain identity backend that `search` queries. A trailing slash is
  optional.
- **`identity`** — an identity repository, typed `IdentitySource` (`Pick<IdentityRepository, 'getIdentity'>` from
  `@novasamatech/host-papp`).

The service takes a repository rather than a chain client, so a host that also runs `createPappAdapter` can pass
`papp.identity` straight in and share one cache and one chain connection:

```ts
const papp = createPappAdapter({ appId: 'my-host-app' });
const accounts = createAccountService({ identityEndpoint, identity: papp.identity });
```

It also makes the service trivial to test — the whole dependency is one function:

```ts
const accounts = createAccountService({
  identityEndpoint,
  identity: { getIdentity: () => okAsync(null) },
});
```

Returns an object with two methods:

- **`search(query, status)`** — query the off-chain username index. `status` is `'ASSIGNED' | 'PENDING'`. Resolves to a
  list of `{ candidateAccountId, username, status, onchainData, createdAt, updatedAt }` rows.
- **`getConsumerInfo(address)`** — resolve a single SS58 address to an `Identity`
  (`{ accountId, fullUsername, liteUsername, credibility, identifierKey }`) by reading `Resources.Consumers` from the
  People chain. Returns `null` if the account has no consumer entry, and an `err` if `address` is not a valid SS58
  address.

Both methods return `ResultAsync<…, Error>`; call `.isOk()` / `.isErr()` to discriminate.

`Identity` and `Credibility` are re-exported from `@novasamatech/host-papp`, which owns the `Resources.Consumers` reader
this package delegates to — see its [identity lookups](../host-papp/README.md#identity-lookups) section. Note that
`credibility.lastUpdate` is `string | null`: it is `null` when the chain record carries no readable timestamp.

## Codec subpath exports

The chat wire codecs are exposed under explicit subpaths so they can be tree-shaken independently of the main entry
point:

```ts
import {
  ChatMessage,
  TextContent,
  RichTextContent,
  ChatAcceptedContent,
  DeviceAddedContent,
  DeviceRemovedContent,
} from '@novasamatech/host-chat/codec/message';

import { FileMeta, FileVariant, P2PMixnetFile } from '@novasamatech/host-chat/codec/attachment';

import type { ChatSession } from '@novasamatech/host-chat/session';
```

These are byte-compatible with the Android / iOS Polkadot Mobile clients — modify with care, the indices are pinned by
the protocol.
