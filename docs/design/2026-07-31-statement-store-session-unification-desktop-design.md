# Design (2/2): unified statement-store session — desktop changes

**Date:** 2026-07-31
**Repo:** `novasamatech/polkadot-browser` (`src/domains`)
**Depends on:** [SDK design](./2026-07-31-statement-store-session-unification-sdk-design.md) — steps 1–4 must ship first
**Research:** [research report](./2026-07-31-statement-store-session-unification-research.md)

## Scope

Delete desktop's four hand-rolled statement transports and route every one of
them through the SDK session that the companion design adds.

**In scope:** `chat/p2p/chatSessionV2.ts`, `chat/p2p/multi-device/`,
`chat/p2p/subscription-registry.ts`, `chat/p2p/session-transport/`,
`device-sync/transport.ts`, `device-session/service.ts`, and the
`managerV2Factory.ts` wiring that binds them.

**Out of scope:** chat UI, chat-request discovery (`chat/p2p/requests/`), file
transfer, push notifications, the Dexie schema (read/written as-is), any SDK
change.

## Baseline

| File | LOC | Fate |
|---|---:|---|
| `chat/p2p/chatSessionV2.ts` | 914 | **deleted** → `createMultiDeviceSession` |
| `chat/p2p/multi-device/service.ts` + `types.ts` + `constants.ts` | ~300 | **deleted** → SDK `codec/envelope.ts` |
| `chat/p2p/subscription-registry.ts` | 63 | **deleted** → one `matchAny` sub per session |
| `chat/p2p/session-transport/gateway.ts` | 447 | ~150 kept (routing helpers), transport body deleted |
| `chat/p2p/session-transport/schemas.ts` | 90 | **deleted** → SDK `host-chat` codec (3-variant `Platform`) |
| `device-sync/transport.ts` | 182 | **deleted** → `createSession` on the device topic |
| `device-session/service.ts` | 67 | folded into the same session |
| `chat/p2p/managerV2Factory.ts` | 1646 | rewired; outbox plumbing removed |

Net expectation: **~1,400 lines deleted**, no new module.

---

## 1. Target wiring

```
managerV2Factory
  └─ per contact:
       createMultiDeviceSession({           ← chat traffic, per peer
            localDevice, localIdentity, remoteIdentity,
            peerRoster: rosterPort(contact),   // Dexie-backed, observable
            statementStore, allocator, maxRequestSize })
       createSession({ … identity topic … })  ← deviceChatAccepted / deviceAdded / deviceRemoved
  └─ per sibling device:
       createSession({ … device topic … })    ← device-sync WebRTC signaling
```

One `ExpiryAllocator` per signing account, shared across all of the above —
already the rule in `shared/statement-store/submit.ts`, now enforced by passing
the same instance into every `create*Session` call.

---

## 2. Chat session replacement

`createChatPeerSessionV2` → `createMultiDeviceSession`. The manager's contract
with the session shrinks to:

| Today (`V2ChatPeerSession`) | After |
|---|---|
| `send(content, opts) → { messageId, timestamp, parked }` | `session.submitRequestMessage(ChatMessage, msg)` |
| `onSent(messageId)` | `notifySent` effect → subscriber |
| `onDelivered(messageId)` | `waitForResponseMessage` / `notifyDelivered` |
| `onUndeliverable(messageId)` | `notifyTooLarge` effect |
| `onMessage({ … })` | `session.subscribe(ChatMessage, …)` |
| `outbox: OutboxPort` | **gone** (§3) |
| `maxStatementDataBytes` | `maxRequestSize` |

`parked` disappears from the public shape: queueing is the session's
`pending` state, and the manager learns the outcome from `notifySent`. Callers
that today branch on `parked` (e.g. best-effort `leftChat`) instead treat
"no `notifySent` yet" as not-on-the-wire.

---

## 3. Removing the outbox

`chatSessionV2.ts:278-284` justifies a localStorage outbox with:

> Our own MultiRequest inner is unreadable to us (the one-shot key is wrapped
> for recipient devices only), so unlike the SDK's init() we can't rebuild the
> batch from the store — the persisted record IS the source.

This is false. The per-device wrap secret is
`x25519(senderDevicePriv, recipientDevicePub)`, which the sender can re-derive
for any recipient it wrapped for; the outer layer uses the same key we
encrypted with. The SDK's `envelope.unwrapOwn` (SDK design §3) makes our own
statements readable, so the **store** holds the outgoing-request state, exactly
as `base-spec.md` intends.

Replacement mapping:

| Outbox field | Replaced by |
|---|---|
| `unackedEntries` | `session.fetchOutgoing()` → `decodeOwn` at init, per `base-spec.md` §"Session Initialization Phase" |
| `queuedEntries` (parked FIFO) | Dexie messages with `status = outgoing/new`, re-fed on session activation |
| `notified` flag | `LocalMessage.status` (`new` → `sent` → `delivered`) — the field already exists |
| `requestCoverage` map + `MAX_COVERAGE_ENTRIES` pruning | the session's single `outgoingRequest.messages`; an ACK covers exactly that batch |
| `persistOutbox()` / `outbox.load()` / `OutboxPort` | deleted |
| `drainRetryTimer` (30 s) | `submitWithRetry` in the SDK driver |
| `DataTooLarge` rollback dance | builder-as-size-oracle refuses to build past budget; `DataTooLargeError` from the chain raises the budget and is logged |
| `opPool` single-slot mutex | the state machine is synchronous — no interleaving to guard |

Reconciliation on activation follows `base-spec.md` §"Application Layer
Lifecycle": for every `LocalMessage` marked `sent` that is **not** in the
restored `OutgoingRequest`, mark it `new` so it is re-fed to the session. This
also removes `changedSince.ts`'s dependence on outbox state.

`OutboxPort` and the `localStorage` records are deleted. **A one-shot cleanup
removes stale `p2p-outbox:*` keys on first run after the upgrade** — otherwise
they leak forever.

---

## 4. Subscriptions

Today: one `trackedSubscribeStatements` per peer device
(`chatSessionV2.ts:880`), with a process-wide 120-subscription budget counter to
contain the N contacts × M devices growth.

After: the SDK's `createRosterTopics` yields one `matchAny([...deviceTopics])`
subscription per peer, re-opened when the roster changes. `subscription-registry.ts`
and `SUBSCRIPTION_BUDGET` are deleted.

`application/statement-store/reconnectAwareSubscribe.ts` stays — it solves a
different problem (subscription id remapping after a chain reconnect) and sits
below the session.

---

## 5. Roster port

The session needs an observable device list per peer:

```ts
type PeerRoster = {
  current(): DeviceTarget[];
  subscribe(cb: (devices: DeviceTarget[]) => void): VoidFunction;
};
```

Backed by the existing Dexie contact-device table that `deviceAdded` /
`deviceRemoved` already maintain. Today a roster change **recreates** the whole
session (`managerV2Factory`); after this change the session absorbs it — the
outgoing builder reads recipients through a thunk and the incoming topic set
re-subscribes. That removes the recreate path and, with it, the
`persistOutbox`-on-disposed-session guard it necessitated.

The identity-conflated fallback (peer roster containing only the peer identity,
for Android-legacy `chatAccepted @14` peers) is preserved: it is just a roster
of one whose `statementAccountId` is the peer identity — the derivations
collapse to the V1 pairwise shape with no special-casing in the session.

---

## 6. Identity & device channels

`session-transport/gateway.ts` currently hand-rolls
`postChatMessageOnIdentityChannel`, `postChatMessageOnDeviceChannel`,
`postAcceptSignalV2`, and `subscribeToIdentityChannelV2` — each doing its own
encrypt → `signAndSubmitStatement` → topic derivation, with no session state,
no ACK, and a manual `queryStatements` catch-up per subscribe.

After: both channels are ordinary `createSession` instances differing only in
topic/key derivation. `computeRoute` / `computeDeviceRoute` stay as small pure
helpers; the transport bodies go. `decodeEventsFromChatMessage` stays (it maps
`ChatMessage` content → `IdentityChannelEvent`) and becomes a `subscribe`
callback.

`session-transport/schemas.ts` — the forked `ChatMessage` codec that exists only
because the SDK's `Platform` had two variants — is deleted once the SDK ships
the 3-variant `Platform` (SDK design §10). All decode sites move back to
`@novasamatech/host-chat/codec/message`.

Consequence worth stating: the identity channel gains transport ACKs, so a
`deviceChatAccepted` becomes reliably retransmitted-until-acked instead of
fire-and-forget.

---

## 7. Device-sync

`device-sync/transport.ts` maps the orchestrator's
`postStatement` / `subscribeStatementTopic` ports onto raw statements with its
own allocator and retry schedule. It becomes a `createSession` on the
device-to-device topic (`mds.md` §"Data channel signaling" — WebRTC signaling
carried as `SyncSignalingEnvelope` over the ordinary Request/Response
mechanism).

`submissionSecsFromExpiry` and `EXPIRY_DURATION_SECS` are a receive-side legacy
age filter for pre-pinned-high statements. Keep them for now behind a dated
comment; they are removable once no deployed client writes the legacy layout.

`device-session/service.ts` folds into the same session construction.

---

## 8. Step order

Each step is independently shippable, and each keeps the app working.

| # | Step | Blast radius |
|---|---|---|
| 5a | Bump SDK to the version with steps 1–4; delete `multi-device/service.ts` and `session-transport/schemas.ts`, re-point imports | mechanical |
| 5b | Add the `PeerRoster` port over the existing Dexie device table | additive |
| 5c | Swap `createChatPeerSessionV2` → `createMultiDeviceSession` in `managerV2Factory`; delete `chatSessionV2.ts` | chat send/receive |
| 5d | Delete `OutboxPort` + implementation; add the reconciliation-on-activation path and the stale-key cleanup | chat status flow |
| 5e | Delete `subscription-registry.ts` | subscriptions |
| 6 | Identity/device channels onto `createSession`; trim `session-transport/gateway.ts` | accept + roster fanout |
| 7 | `device-sync/transport.ts` + `device-session/service.ts` onto `createSession` | device sync |

Steps 5c and 5d are the risky pair and should ship together behind one release,
since 5c without 5d leaves two sources of truth for the outgoing batch.

---

## 9. Testing

- **Kept green:** `chatSessionV2.spec.ts` is deleted with its subject, but its
  scenarios are ported to the SDK's state-machine and integration tests — an
  explicit port list is a step-5c deliverable, not an implicit loss.
- `service.spec.ts`, `repository.spec.ts`, `changedSince.spec.ts`,
  `session-transport/*.spec.ts` must pass unchanged where they do not reference
  deleted modules.
- New: reconciliation test — persisted `sent` messages absent from the restored
  `OutgoingRequest` are re-marked `new` and resent.
- New: roster-change test — adding a peer device mid-session re-derives topics
  and the next send addresses the new device, with no session recreate.
- Manual cross-client check against a real Android build for the chat round trip
  is a prerequisite for shipping step 5c. **Note:** Android is still on
  P-256 + AES-GCM (RFC-0004 not yet implemented there), so this check is only
  meaningful once Android's crypto migration lands. Until then, cross-client
  verification is limited to wire-format fixtures.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| `unwrapOwn` premise wrong → outgoing state unrecoverable | SDK round-trip test proves it before step 5d; 5c ships with the outbox still present, so 5d is reversible |
| Message status regressions (`new`/`sent`/`delivered`) | reconciliation test + the `notified`→`LocalMessage.status` mapping is 1:1 |
| Stale `p2p-outbox:*` localStorage keys | one-shot cleanup in step 5d |
| Roster-change handling regresses the identity-conflated Android-legacy path | it is a roster of one — covered by a dedicated test |
| Losing `chatSessionV2.spec.ts` coverage | explicit port list, reviewed as part of 5c |
