# @novasamatech/host-papp

Polkadot app integration layer for host applications.

## Overview

`@novasamatech/host-papp` is the integration SDK that lets a javascript-based host embed Polkadot Mobile capabilities.
It encapsulates everything needed to:

- pair the host with a Polkadot wallet/SSO provider via a deeplink handshake;
- store and manage paired user sessions;
- send signing requests and ring-VRF alias requests to the paired wallet;
- look up on-chain identity information for accounts.

The package is UI-framework agnostic — it exposes plain async APIs and observable state (`subscribe` / `read`), so it
can be wired into React, Vue, Svelte, vanilla DOM, or a non-browser runtime.

## Installation

```shell
npm install @novasamatech/host-papp --save -E
```

## Getting started

Create a single adapter instance for the lifetime of your host app and share it across the features that need it.

```ts
import { createPappAdapter } from '@novasamatech/host-papp';

const papp = createPappAdapter({
  // Stable identifier for your host app — must not change between releases,
  // otherwise existing pairings will be lost.
  appId: 'my-host-app',

  // Optional environment metadata shown on the wallet's confirmation screen.
  hostMetadata: {
    hostVersion: '1.4.0',
    osType: 'macOS',
    osVersion: '15.4',
  },
});
```

`createPappAdapter` returns five sub-modules:

| Module           | Purpose                                                               |
| ---------------- | --------------------------------------------------------------------- |
| `papp.sso`       | Authentication / pairing flow with a remote wallet.                   |
| `papp.sessions`  | List of paired user sessions and per-session messaging (sign, etc.).  |
| `papp.secrets`   | Local secret storage for the derived guest accounts.                  |
| `papp.identity`  | On-chain identity lookups for arbitrary account ids.                  |
| `papp.allowance` | Resource allowances (bulletin / statement-store signers) per product. |

Custom adapters (statement store, identity RPC, storage, lazy chain client) can be supplied via the `adapters` option
for testing or non-browser environments.

## Authentication and pairing (V1)

The V1 SSO flow described in this section is the single-device pairing protocol used by `papp.sso.authenticate()`. For
the multi-device V2 protocol see [V2 SSO handshake](#v2-sso-handshake) below.

`papp.sso.authenticate()` runs the full pairing + attestation flow and resolves with the stored user session, or `null`
if the flow was aborted. The flow is idempotent — calling it again while a previous run is in flight returns the same
in-progress promise.

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

The pairing process is observable. UI code typically renders a QR code / deeplink while the status is `pairing`, then
transitions to a "signing in" screen during attestation.

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

`papp.sso.attestationStatus` exposes the same `read` / `subscribe` shape and tracks attestation progress (`attestation`
with a claimed `username`, `attestationError`, or `finished`). For convenience, treat the two streams as a single
derived UI state — pairing steps before `attestation`, then attestation, then back to pairing's `finished`.

## Managing user sessions

`papp.sessions.sessions` is an observable list of currently paired sessions. Most host apps work with the first one
(single-user model), but the SDK does not enforce that.

```ts
import type { UserSession } from '@novasamatech/host-papp';

let currentSession: UserSession | null = null;

const unsubscribe = papp.sessions.sessions.subscribe(sessions => {
  currentSession = sessions.at(0) ?? null;
});

// Initial value, in case a session was restored from storage on boot.
currentSession = papp.sessions.sessions.read().at(0) ?? null;
```

Disconnecting notifies the wallet, removes local secrets, and triggers the subscription above.

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

A `UserSession` exposes `signPayload` and `signRaw` for forwarding signing requests to the paired wallet.

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

`signVrf` asks the wallet for an sr25519 (schnorrkel) VRF signature from a product account (RFC-0023). The transcript
travels as a recipe — a root domain-separation label plus an ordered list of `(label, value)` items — which the wallet
replays verbatim into a Merlin transcript and signs. Callers that need a `signer` item must supply their own public key;
the host never injects it.

```ts
const encoder = new TextEncoder();

const vrf = await currentSession.signVrf({
  productAccountId: ['product.dot', 0],
  productId: 'product.dot',
  transcriptLabel: encoder.encode('pop:airdrop'),
  items: [
    { label: encoder.encode('domain'), value: domainBytes },
    { label: encoder.encode('signer'), value: accountPublicKey },
  ],
});

vrf.match(
  ({ preOutput, proof }) => submitLotteryTicket(preOutput, proof),
  error => console.error('VRF signing failed:', error),
);
```

This is the non-`AutoSigning` path only: when `AutoSigning` covers the account the host signs locally and never
round-trips to the wallet.

## Ring VRF proofs and aliases

A `UserSession` can ask the paired device for a privacy-preserving contextual alias, or a ring VRF proof, for a
product-scoped `context` and a `ring` location. The device selects the member key for the ring; `callingProductId` names
the product the host is acting for. Both take the same `(context, ring)` so the alias in the proof matches
`getRingVrfAlias`.

```ts
// [productId, suffix]. The suffix is the wire `Index(u32) | Raw([u8; 32])` selector
// (RFC 0022): `Index` for a plain index, `Raw` for a raw 32-byte index. It
// expands to the same 32-byte value as a product account's derivation index.
const context = ['product.dot', { tag: 'Index', value: 0 }];
const ring = {
  chainId: '0x…', // 32-byte chain genesis hash
  junctions: [{ tag: 'PalletInstance', value: 42 }],
};

const alias = await currentSession.getRingVrfAlias('caller.dot', context, ring);

const proof = await currentSession.createRingVrfProof('caller.dot', context, ring, new Uint8Array([0x48, 0x69]));
proof.match(
  ({ proof, contextualAlias, ringIndex, ringRevision }) =>
    console.log('proof at ring', ringIndex, 'revision', ringRevision),
  // failures decode to a structured `RingVrfError` (RingNotFound / NotMember / Rejected / Unknown)
  error => console.error('proof failed:', error),
);
```

## Product subtree public keys

Product accounts live at `//product//{productId}/{index}` (RFC 0022). The product junction is **hard**, so the user's
root public key alone no longer determines product account public keys — the host asks the paired device for the
product-subtree public key once, then soft-derives account public keys locally from it.

```ts
const subtreeKey = await currentSession.getProductSubtree('product.dot');

subtreeKey.match(
  publicKey => cacheProductSubtree('product.dot', publicKey), // one round trip per product, ever
  error => console.error('subtree lookup failed:', error),
);
```

The request is consent-free — the response carries no secret material. Only `AutoSigning` does: its payload is now the
product-subtree secret key alone (`productRootPrivateKey`, 64-byte expanded sr25519 secret), which exposes exactly that
product's subtree. The former `productDerivationSecret` is gone.

## Identity lookups

`papp.identity` resolves on-chain identity data (lite / full username, credibility, chat encryption key) for arbitrary
account ids. Pass an `0x`-prefixed account id (32-byte hex).

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

A paired `UserSession` also exposes `getIdentity()` as a shortcut that looks up the identity of its own user identity
account — no account id to pass:

```ts
const identity = await session.getIdentity(); // Result<Identity | null, Error>
```

`Identity` is:

```ts
type Identity = {
  accountId: string;
  fullUsername: string | null;
  liteUsername: string;
  credibility: { type: 'Lite' } | { type: 'Person'; alias: `0x${string}`; lastUpdate: string | null };
  /** 32-byte X25519 chat encryption key as hex, unwrapped from the 65-byte
   *  RFC-0004 container; null for a keypair type this SDK does not implement. */
  identifierKey: `0x${string}` | null;
};
```

`lastUpdate` and `identifierKey` are both nullable — the chain record can carry neither a readable timestamp nor a key
this SDK can use, and neither case is an error.

This package owns the `Resources.Consumers` reader for the monorepo. `host-chat` reads through it rather than querying
the chain itself; `createIdentityRpcAdapter` is exported for that, alongside the `Identity` and `Credibility` types.

## V2 SSO handshake

V2 is a redesign of the SSO pairing flow that supports the same user identity across multiple devices. The host
generates a stable device keypair locally, emits a `VersionedHandshakeProposal::V2` via QR/deeplink, and an authorising
peer (e.g. the user's existing Polkadot App) responds over the Statement Store with the user identity keys signed to
authorise this device. Subsequent devices belonging to the same user reuse the same identity, so contacts, chats, and
roster events are shared between them.

V2 is **not interoperable with V1**: a V1-only peer can't decode a V2 proposal QR and vice versa. Hosts that want to
support both should branch on which protocol the peer advertises.

### The flow

1. The host builds a pairing deeplink from its device keypair and shows it as a QR code.
2. The authorising device scans it and posts its response to the Statement Store: first a `Pending` acknowledgement,
   then either `Success` — carrying the user's identity keys, signed to authorise this device — or `Failed`.
3. The host polls the pairing topic, decrypts and verifies each response, and drives a
   `Submitted → Pending → Success | Failed` state machine. On `Success` it persists the user identity.

### Building and rendering the QR

```ts
import { buildPairingDeeplink } from '@novasamatech/host-papp';

const deeplink = buildPairingDeeplink(
  {
    statementAccountPublicKey: device.statementAccountPublicKey, // sr25519 device pubkey, 32 bytes
    encryptionPublicKey: device.encryptionPublicKey, // P-256 device pubkey, 65 bytes uncompressed
  },
  {
    hostName: 'My Host App',
    hostVersion: '1.0.0',
    platformType: 'macOS',
    platformVersion: '15.4',
  },
);

renderQrCode(deeplink); // 'polkadotapp://pair?handshake=<hex>'
```

### Driving the handshake

```ts
import { startPairingV2 } from '@novasamatech/host-papp';

const pairing = startPairingV2({
  statementStore, // any StatementStoreAdapter
  deviceIdentity: {
    statementAccountPublicKey: device.statementAccountPublicKey,
    encryptionPublicKey: device.encryptionPublicKey,
    encryptionPrivateKey: device.encryptionPrivateKey, // P-256 priv key, 32 bytes
  },
  metadata: {
    hostName: 'My Host App',
    hostVersion: '1.0.0',
    platformType: 'macOS',
    platformVersion: '15.4',
  },
  persistOnSuccess: async success => {
    // success.identityChatPublicKey, success.userIdentityAccountId,
    // success.identitySignature — persist in your secureStore.
  },
});

pairing.qrPayload; // 'polkadotapp://pair?handshake=<hex>' for the QR UI

pairing.state$.subscribe(state => {
  switch (state.tag) {
    case 'Submitted':
      // QR shown, waiting for the peer to scan
      return;
    case 'Pending':
      // peer acknowledged; allocating Statement Store allowance on-chain
      return;
    case 'Success':
      // identity received, device authorised
      return;
    case 'Failed':
      // peer rejected (declined / duplicate / no-slot / tx-failed)
      console.error(state.reason);
      return;
  }
});

// Cancel mid-flight (the Observable completes, polling stops, subscription closes):
pairing.abort();
```

### Surviving reloads / proper logout

The chain holds the most recent statement on the pairing topic indefinitely, so on cold start the service will see the
previous Success and replay it. To distinguish a stale replay from a fresh re-pair, callers can pass byte-level dedupe
state:

```ts
const pairing = startPairingV2({
  // ...
  initialProcessedDataHex: await secureStore.get('lastProcessedHandshakeStatement'),
  onStatementProcessed: hex => {
    void secureStore.set('lastProcessedHandshakeStatement', hex);
  },
});
```

The service skips any incoming statement whose bytes match `initialProcessedDataHex`. PApp re-encrypts every Success
with a fresh ephemeral key + AES-GCM nonce, so a genuine re-pair always produces different bytes and passes the dedupe.

## Reading allowances

Each `UserSession` can read its own persisted allowance slot-account key for a given product and resource. The session
id is implicit — you only pass the product and resource:

```ts
const session = papp.sessions.sessions.read().at(0);

// resource: 'bulletin' | 'statementStore'
const key = await session.readAllowance(productId, 'statementStore'); // Result<Uint8Array | null, Error>
```
