# @novasamatech/host-papp

Polkadot app integration layer for host applications.

## Overview

`@novasamatech/host-papp` is the integration SDK that lets a javascript-based host embed Polkadot
Mobile capabilities. It encapsulates everything needed to:

- pair the host with a Polkadot wallet/SSO provider via a deeplink handshake;
- store and manage paired user sessions;
- send signing requests and ring-VRF alias requests to the paired wallet;
- look up on-chain identity information for accounts.

The package is UI-framework agnostic — it exposes plain async APIs and observable state
(`subscribe` / `read`), so it can be wired into React, Vue, Svelte, vanilla DOM, or a
non-browser runtime.

## Installation

```shell
npm install @novasamatech/host-papp --save -E
```

## Getting started

Create a single adapter instance for the lifetime of your host app and share it across the
features that need it.

```ts
import { createPappAdapter } from '@novasamatech/host-papp';

const papp = createPappAdapter({
  // Stable identifier for your host app — must not change between releases,
  // otherwise existing pairings will be lost.
  appId: 'my-host-app',

  // URL to a JSON document describing the host: { name: string, icon: string }.
  // The icon should be a rasterized image at least 256x256 px.
  metadata: 'https://my-host-app.example/papp-metadata.json',

  // Optional environment metadata shown on the wallet's confirmation screen.
  hostMetadata: {
    hostVersion: '1.4.0',
    osType: 'macOS',
    osVersion: '15.4',
  },
});
```

`createPappAdapter` returns four sub-modules:

| Module          | Purpose                                                                |
| --------------- | ---------------------------------------------------------------------- |
| `papp.sso`      | Authentication / pairing flow with a remote wallet.                    |
| `papp.sessions` | List of paired user sessions and per-session messaging (sign, etc.).   |
| `papp.secrets`  | Local secret storage for the derived guest accounts.                   |
| `papp.identity` | On-chain identity lookups for arbitrary account ids.                   |

Custom adapters (statement store, identity RPC, storage, lazy chain client) can be supplied
via the `adapters` option for testing or non-browser environments.

## Authentication and pairing

`papp.sso.authenticate()` runs the full pairing + attestation flow and resolves with the
stored user session, or `null` if the flow was aborted. The flow is idempotent — calling it
again while a previous run is in flight returns the same in-progress promise.

```ts
const result = await papp.sso.authenticate();

result.match(
  session => {
    if (session) {
      console.log('Paired with', session.remoteAccount.accountId);
    } else {
      console.log('Pairing aborted');
    }
  },
  error => {
    console.error('Pairing failed:', error);
  },
);
```

To cancel a running flow:

```ts
papp.sso.abortAuthentication();
```

### Reacting to pairing status

The pairing process is observable. UI code typically renders a QR code / deeplink while the
status is `pairing`, then transitions to a "signing in" screen during attestation.

```ts
import type { PairingStatus } from '@novasamatech/host-papp';

const render = (status: PairingStatus) => {
  switch (status.step) {
    case 'none':
    case 'initial':
      return; // not started yet
    case 'pairing':
      // status.payload is a `polkadotapp://pair?handshake=…` deeplink —
      // render it as a QR code or open it on mobile.
      showDeeplink(status.payload);
      return;
    case 'pairingError':
      showError(status.message);
      return;
    case 'finished':
      showPairedAccount(status.session);
      return;
  }
};

render(papp.sso.pairingStatus.read());
const unsubscribe = papp.sso.pairingStatus.subscribe(render);
```

`papp.sso.attestationStatus` exposes the same `read` / `subscribe` shape and tracks
attestation progress (`attestation` with a claimed `username`, `attestationError`, or
`finished`). For convenience, treat the two streams as a single derived UI state — pairing
steps before `attestation`, then attestation, then back to pairing's `finished`.

## Managing user sessions

`papp.sessions.sessions` is an observable list of currently paired sessions. Most host apps
work with the first one (single-user model), but the SDK does not enforce that.

```ts
import type { UserSession } from '@novasamatech/host-papp';

let currentSession: UserSession | null = null;

const unsubscribe = papp.sessions.sessions.subscribe(sessions => {
  currentSession = sessions.at(0) ?? null;
});

// Initial value, in case a session was restored from storage on boot.
currentSession = papp.sessions.sessions.read().at(0) ?? null;
```

Disconnecting notifies the wallet, removes local secrets, and triggers the subscription
above.

```ts
const disconnect = async (session: UserSession) => {
  const result = await papp.sessions.disconnect(session);
  result.match(
    () => console.log('Disconnected'),
    error => console.error('Disconnect failed:', error),
  );
};
```

## Signing

A `UserSession` exposes `signPayload` and `signRaw` for forwarding signing requests to the
paired wallet.

```ts
const signed = await currentSession.signPayload({
  address: '5G…', // SS58 address or 0x-prefixed account id
  blockHash: '0x…',
  blockNumber: '0x…',
  era: '0x…',
  genesisHash: '0x…',
  method: '0x…',
  nonce: '0x…',
  specVersion: '0x…',
  tip: '0x…',
  transactionVersion: '0x…',
  signedExtensions: ['CheckNonZeroSender', 'CheckSpecVersion' /* … */],
  version: 4,
  assetId: undefined,
  metadataHash: undefined,
  mode: undefined,
  withSignedTransaction: undefined,
});

signed.match(
  response => submitSignedExtrinsic(response),
  error => console.error('Signing rejected:', error),
);
```

`signRaw` follows the same pattern but takes either raw `Bytes` or a `Payload` string:

```ts
await currentSession.signRaw({
  address: '5G…',
  data: { tag: 'Payload', value: 'Login challenge: abc123' },
});
```

## Identity lookups

`papp.identity` resolves on-chain identity data (lite / full username, credibility, slots)
for arbitrary account ids. Pass an `0x`-prefixed account id (32-byte hex).

```ts
const lookup = async (accountId: string) => {
  const result = await papp.identity.getIdentity(accountId);
  result.match(
    identity => {
      if (!identity) return;
      console.log(identity.liteUsername, identity.credibility);
    },
    error => console.error('Identity lookup failed:', error),
  );
};

// Batch lookup
await papp.identity.getIdentities([accountIdA, accountIdB]);
```
