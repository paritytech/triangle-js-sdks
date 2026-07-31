# Design (1/2): unified statement-store session — SDK changes

**Date:** 2026-07-31
**Status:** implemented on `feat/statement-store-session-unification`, with two
documented deviations — see §7.1 and §7.2.
**Repo:** `paritytech/triangle-js-sdks`
**Companion:** [desktop design](./2026-07-31-statement-store-session-unification-desktop-design.md)
**Research:** [research report](./2026-07-31-statement-store-session-unification-research.md)

## Scope

`packages/statement-store` gains the multi-device wire format and the session
architecture that desktop and Android already run, so a single session
implementation can serve every consumer. `packages/host-chat` gets one codec fix.

**In scope:** `StatementData` variants 2/3, the multi-device envelope, a pure
session state machine, pluggable outgoing-body / incoming-topics / decoder seams,
`createMultiDeviceSession`, builder-driven sizing, the `host-chat` `Platform` fix.

**Out of scope:** crypto primitives (X25519 + ChaCha20-Poly1305 per RFC-0004 are
assumed settled; Android's migration is tracked separately and does not
constrain this work), chat-request discovery, HOP / file transfer, RFC-0002
compaction (seam only), RFC-0003 deletion, any desktop change.

## Goal

| Consumer | Today | After |
|---|---|---|
| `host-papp` SSO | `createSession` | `createSession` — wire-identical, no call-site change |
| desktop chat | own 914-line reimplementation | `createMultiDeviceSession` |
| desktop identity/device channel | own gateway | `createSession` on the identity topic |
| desktop device-sync | own transport | `createSession` on the device topic |
| `host-chat` chat session | stub, fully commented out | chat layer over `createMultiDeviceSession` |

The exported `Session` type does not change. Every SDK step below is
wire-additive: statements produced by `createSession` are byte-identical before
and after.

---

## 1. Module layout

```
packages/statement-store/src/session/
  stateMachine/
    states.ts        Initialization | Active
    events.ts        SessionEvent union
    effects.ts       SessionEffect union
    transition.ts    (state, event, ctx) → { state, effects }   ← pure
  transport.ts       fetchOutgoing / fetchIncoming / subscribe / submit
  codec/
    envelope.ts      multi-device wrap / unwrap
    outgoingBody.ts  OutgoingBodyBuilder  [single | multiDevice]
    incomingTopics.ts IncomingTopics      [static | roster]
    decoder.ts       StatementDecoder     (tags 0–3, peer + own)
  scale/statementData.ts   + multiRequest(2), multiResponse(3)
  session.ts         driver (side-effects → I/O, events → subscribers)
  factory.ts         createSession | createMultiDeviceSession
```

Existing `session/encyption.ts`, `session/statementProver.ts`,
`session/messageMapper.ts`, `session/error.ts`, `submit/*`, `model/*`,
`adapter/*` are unchanged.

---

## 2. Wire codec — `scale/statementData.ts`

`scale-ts` `Enum` assigns indices by declaration order, so 0/1 stay put:

```ts
export const RequestDeviceInfo = Struct({
  statementAccountId: Bytes(32),   // fixed 32, matching Android post-#605 and desktop
  encryptedKey: Bytes(),
});

export const MultiRequest  = Struct({ encryptedRequest:  Bytes(), devicesInfo: Vector(RequestDeviceInfo) });
export const MultiResponse = Struct({ encryptedResponse: Bytes(), devicesInfo: Vector(RequestDeviceInfo) });

export const StatementData = Enum({
  request: Request,             // 0
  response: Response,           // 1
  multiRequest: MultiRequest,   // 2
  multiResponse: MultiResponse, // 3
});
```

Matches `mds.md` §"Sending P2P Messages", Android
`StructuredStatementData.kt`, and desktop `requests/schemas.ts`.

---

## 3. Multi-device envelope — `codec/envelope.ts`

Ported from desktop `chat/p2p/multi-device/service.ts`, with one addition.

```ts
export type DeviceTarget = { statementAccountId: Uint8Array; encryptionPublicKey: Uint8Array };

export type Envelope = {
  wrap(plaintext: Uint8Array, recipients: DeviceTarget[]):
    Result<{ encryptedPayload: Uint8Array; devicesInfo: RequestDeviceInfo[] }, Error>;

  /** Peer→us: locate our own entry, unwrap against the sender's device pubkey. */
  unwrapForOwnDevice(payload: Uint8Array, devicesInfo: RequestDeviceInfo[],
                     senderEncryptionPublicKey: Uint8Array): Result<Uint8Array, Error>;

  /** Us→peer, read back: locate any known peer entry, re-derive the wrap secret. */
  unwrapOwn(payload: Uint8Array, devicesInfo: RequestDeviceInfo[],
            peerDevices: DeviceTarget[]): Result<Uint8Array, Error>;
};

export function createEnvelope(params: {
  ownStatementAccountId: Uint8Array;
  ownEncryptionPrivateKey: Uint8Array;
}): Envelope;
```

Crypto, unchanged from what desktop and Android already agree on:

- one-shot key: 32 random bytes, used **raw** as the AEAD key (no HKDF) —
  `chacha20poly1305(key, nonce12)`, framing `nonce ‖ ct ‖ tag`
- per-device wrap: `createEncryption(x25519(ownEncPriv, recipientEncPub))`,
  i.e. HKDF-SHA256 inside `createEncryption`, then the same AEAD

`unwrapOwn` is the new piece. The wrap secret is
`x25519(senderDevicePriv, recipientDevicePub)`; the sender can re-derive it for
any recipient it wrapped for, so its own envelope is readable. Android does this
in `MultiDeviceEnvelopeEncryption.unwrapOwn()`. It is what lets the *store* hold
the outgoing-request state instead of a client-side outbox
(see the desktop design, §3).

`wrap` rejects an empty recipient list.

---

## 4. Outgoing body builder — `codec/outgoingBody.ts`

```ts
export type StatementBody = { channel: Uint8Array; topics: Uint8Array[]; data: Uint8Array };

export type OutgoingBodyBuilder = {
  buildRequest(requestId: string, messages: Uint8Array[]): Result<StatementBody, Error>;
  buildResponse(requestId: string, code: ResponseStatus): Result<StatementBody, Error>;
};

export function createSingleBodyBuilder(p: { topic: SessionId; encryption: Encryption }): OutgoingBodyBuilder;

export function createMultiDeviceBodyBuilder(p: {
  topic: SessionId;
  encryption: Encryption;
  envelope: Envelope;
  /** Thunk, so a roster change is picked up on the next submit. */
  recipients: () => DeviceTarget[];
}): OutgoingBodyBuilder;
```

Single: `encode(StatementData.request) → encryption.encrypt` on
`khash(topic, "request")`.
Multi: `encode(Request) → envelope.wrap → encode(StatementData.multiRequest) →
encryption.encrypt`, same channel derivation.

### The builder is the size oracle

The driver builds the body it is about to submit and measures
`body.data.length` against the budget. Consequences:

- AEAD expansion and per-device fan-out are counted by construction — the two
  things the SDK's current pre-encryption `requestPayloadSize()` and Android's
  raw-byte sum both miss
- there is exactly one sizing implementation, and it is the same code path that
  produces the submitted bytes
- on the happy path the trial build *is* the submission — no wasted work

`STATEMENT_OVERHEAD = 168` (topic 32 + channel 32 + expiry 8 + signature 64 +
signer 32) still applies: budget = `maxRequestSize − STATEMENT_OVERHEAD`.
`maxRequestSize` keeps its name and its `4096` default so `host-papp`'s
`MAX_SSO_REQUEST_SIZE` call site is untouched.

---

## 5. Incoming topics — `codec/incomingTopics.ts`

```ts
export type IncomingTopicSpec = {
  topic: SessionId;
  senderEncryptionPublicKey: Uint8Array;
  encryption: Encryption;
};

export type IncomingTopics = {
  current(): IncomingTopicSpec[];
  /** Fires when the set changes (peer roster add/remove). */
  subscribe(cb: (specs: IncomingTopicSpec[]) => void): VoidFunction;
};

export function createStaticTopics(spec: IncomingTopicSpec): IncomingTopics;

export function createRosterTopics(p: {
  localIdentityAccountId: AccountId;
  ownIdentityChatPrivateKey: Uint8Array;
  peerRoster: { current(): DeviceTarget[]; subscribe(cb): VoidFunction };
}): IncomingTopics;
```

`createRosterTopics` derives, per peer device `D(B')`:
`K = x25519(ownIdentityChatPriv, D(B').encPub)` and
`topic = SessionId(D(B'), A)` keyed by that `K` — the receive-side mirror of the
sender's `SessionId(D(A), B)`.

The driver opens **one** `matchAny(specs.map(s => s.topic))` subscription and
re-opens it when `subscribe` fires. This replaces desktop's one-subscription-per-
peer-device model (and the 120-subscription budget counter that exists to
contain it).

---

## 6. Decoder — `codec/decoder.ts`

```ts
export type TransportEvent =
  | { tag: 'request';  requestId: string; messages: Uint8Array[]; expiry?: bigint }
  | { tag: 'response'; requestId: string; code: ResponseStatus;  expiry?: bigint }
  /** Outer decrypt succeeded, inner decode did not — NACK-able. */
  | { tag: 'undecodable'; requestId: string | null };

export type StatementDecoder = {
  decodePeer(statement: Statement, spec: IncomingTopicSpec): ResultAsync<TransportEvent, Error>;
  decodeOwn(statement: Statement, peerDevices: DeviceTarget[]): ResultAsync<TransportEvent, Error>;
};
```

Both verify the proof first (`prover.verifyMessageProof`), then decrypt the
outer layer, then decode `StatementData`. Tags 2/3 are unwrapped via
`envelope.unwrapForOwnDevice` (peer) or `envelope.unwrapOwn` (own) and the inner
`Request`/`Response` decoded; tags 0/1 are used directly. Single-device sessions
pass an envelope that fails on tags 2/3.

The existing `recoverRequestId` heuristic (`session.ts:126-136`) moves here and
produces the `undecodable` variant, preserving today's NACK behaviour.

---

## 7. State machine — `stateMachine/` — DEFERRED, NOT IMPLEMENTED

### 7.1 Why it was deferred

Tracing the actual seams needed for `createMultiDeviceSession` showed they are six
contained call sites in the existing driver — the request submit, the response
submit, `clearOutgoingStatement`'s supersede, the store subscription, `init()`'s
decode, and the payload-size check. None of them require the decision logic to be
extracted first.

Extracting the state machine is therefore a refactor for its own sake: the highest-risk
step in the plan (a 792-line driver with subtle retry/expiry semantics and 73 tests) and
the one that unblocks nothing. It is worth doing once the desktop migration has proven
the seams in production, not before. The seams landed directly on the existing driver;
`createSessionCore` is the injection point a later extraction would sit behind.

### 7.2 `incomingRequest` stays a Map (reverses this document's original proposal)

The original text below proposed narrowing to a single `incomingRequest` per
`base-spec.md` §"Session State". **That was wrong and was not implemented.**

Two existing tests pin the Map's behaviour deliberately:
`session.spec.ts:921` (answering an earlier request after a newer one arrives) and
`session.spec.ts:954` (absorbing a superseded response while keeping the request marked
answered). Both matter to `host-papp`, where the responder is asynchronous.

The `session.ts` comment cited as evidence that the Map "cannot be honoured" is about
**wire** delivery — the shared response channel only ever exposes the latest response —
not about the local bookkeeping being wrong. The Map costs nothing on the wire and
prevents double-NACK. The spec's single-value model assumes a synchronous responder,
which this SDK does not require.

### 7.3 The design as originally written (retained for the later extraction)

```ts
type SessionState =
  | { phase: 'initialization'; pending: QueuedMessage[] }
  | { phase: 'active';
      outgoingRequest: { requestId: string; messages: Uint8Array[] } | null;
      incomingRequest: { requestId: string; responded: boolean } | null;
      pending: QueuedMessage[] };

type SessionEvent =
  | { type: 'submitMessage'; message: QueuedMessage }
  | { type: 'initialDataFetched'; outgoingRequest; incomingRequest }
  | { type: 'requestReceived'; requestId; messages }
  | { type: 'responseReceived'; requestId; code }
  | { type: 'respondTo'; requestId; code }
  | { type: 'requestSubmitted'; requestId }
  | { type: 'responseSubmitted'; requestId }
  | { type: 'invalidate'; reason: Error };

type SessionEffect =
  | { type: 'fetchInitialData' }
  | { type: 'submitRequest'; requestId; messages }
  | { type: 'submitResponse'; requestId; code }
  | { type: 'startSubscription' } | { type: 'stopSubscription' }
  | { type: 'notifyRequest'; requestId; messages }
  | { type: 'notifyDelivered'; messages }
  | { type: 'notifySent'; messages }
  | { type: 'notifyTooLarge'; message };

function transition(
  state: SessionState,
  event: SessionEvent,
  ctx: { fits(messages: Uint8Array[]): boolean; newRequestId(): string },
): { state: SessionState; effects: SessionEffect[] };
```

Pure: no I/O, no timers, no clock, no randomness (`newRequestId` is injected).

Three deliberate deviations from Android's equivalent:

1. **One `incomingRequest`, not a set.** `base-spec.md` §"Session State" defines
   `IncomingRequest(A, B)` as a single optional value. The SDK's current `Map`
   cannot be honoured anyway — its own comment at `session.ts:614-618` notes the
   shared response channel only ever exposes the latest response.
2. **`respondTo` is an event.** The response code comes from the Application
   Layer (`base-spec.md` §"Upon receiving responseCode from Application Layer";
   codes 100–255 are the app's, e.g. `ApplicationError.invalidMessage = 100`).
   Android hardcodes `0` at transport level and cannot express those. Auto-ACK
   becomes a driver-level opt-in that injects `respondTo(id, 'success')` on
   `notifyRequest` — which is all chat needs.
3. **Sizing via `ctx.fits`**, delegating to the body builder (§4), rather than a
   byte sum over raw messages.

`transition` is a faithful transcription of `base-spec.md` §"Session
Initialization Phase" and §"Session Active Phase". Where the spec and Android
disagree, the spec wins and the deviation is noted in a comment.

---

## 8. Transport & driver

```ts
type SessionTransport = {
  fetchOutgoing(): ResultAsync<TransportEvent[], Error>;
  fetchIncoming(): ResultAsync<TransportEvent[], Error>;
  subscribeIncoming(cb: (events: TransportEvent[]) => void): VoidFunction;
  submitRequest(requestId, messages): ResultAsync<void, Error>;
  submitResponse(requestId, code): ResultAsync<void, Error>;
};
```

`fetchOutgoing` uses `decodeOwn`; `fetchIncoming` / `subscribeIncoming` use
`decodePeer` and match `statement.topics[0]` against the spec set to pick the
right sender key. `subscribeIncoming` re-opens on topic-set change.

The driver (`session.ts`) keeps, verbatim, everything that already works:

- `submitWithRetry` with `priorityAttempts: 'unbounded'` + `onPriorityError →
  allocator.raiseFloor`, and the `shouldRetry` liveness gate
- injected `ExpiryAllocator` (one per signing account)
- dedup of identical in-flight/queued message bytes with token fan-out
- `pendingDelivery` deferreds behind `waitForResponseMessage`
- buffered-message replay to late subscribers, `waitForRequestMessage`,
  `respondToRequests`, `clearOutgoingStatement`, `dispose`

It loses: the scattered `state.phase` guards, the `incomingRequests` `Map`, and
the `queryStatements`×2-then-subscribe race (the transport owns fetch/subscribe
ordering now).

**`Session` (`session/types.ts`) is unchanged**, so `host-papp` compiles and
behaves identically.

---

## 9. Factories

```ts
// unchanged signature and wire output
createSession({ localAccount, remoteAccount, statementStore, encryption, prover,
                sessionKey, allocator?, maxRequestSize? }): Session

createMultiDeviceSession({
  localDevice:    { statementAccountId, encryptionPrivateKey, prover },
  localIdentity:  { accountId, chatPrivateKey },
  remoteIdentity: { accountId, chatPublicKey },
  peerRoster,     // { current(), subscribe() } of DeviceTarget
  statementStore, allocator?, maxRequestSize?,
}): Session
```

`createMultiDeviceSession` derives the outgoing topic as
`SessionId(D(A), B)` keyed by `x25519(ownDeviceEncPriv, peerIdentityChatPub)`
(`mds.md` §"Sending P2P Messages"), builds a `createMultiDeviceBodyBuilder` and
`createRosterTopics`, and otherwise runs the same driver.

`createSession` is `createMultiDeviceSession`'s single-device sibling: static
topics, single body builder, envelope that rejects tags 2/3.

---

## 10. `host-chat` codec fix

`packages/host-chat/src/codec/message.ts` declares
`Platform = Status('Android', 'iOS')`. iOS PApp emits a third variant for VoIP
push tokens, so any envelope carrying one fails to decode with
`Unknown status index: 2`. Desktop forked the entire `ChatMessage` codec to work
around this (`chat/p2p/session-transport/schemas.ts`).

Add the third variant:

```ts
const Platform = Status('Android', 'iOS', 'iOSVoIP');
```

Byte ordinals are wire format — append only, never reorder. This lets the
desktop fork be deleted (desktop design §6).

---

## 11. Testing

| Layer | Test |
|---|---|
| `transition` | pure unit tests; port Android's `ActiveStateTest` cases plus the spec's Initialization/Active pseudocode paths |
| `codec/*` | SCALE round-trip **and** fixtures captured from Android wire, so enum index and field-order parity is asserted rather than assumed |
| regression | existing `session/session.spec.ts` (1581 lines) runs unmodified against `createSession` — the refactor's safety net |
| integration | new `__tests__/` case: two `createMultiDeviceSession` peers over `createInMemoryStatementStore`, full request → ACK → delivered round trip, including a roster change mid-session |

`npm run build && npm run lint && npm run typecheck && npm test` must pass at
every step boundary (`prepublishOnly` gates on build + lint + test).

---

## 12. Step order

Each step is independently shippable and revertible.

| # | Step | Wire impact | Status |
|---|---|---|---|
| 1 | `statementData` variants 2/3 + `codec/envelope.ts` + `codec/decoder.ts`; `host-chat` `Platform` fix | additive — the SDK can now *read* everything desktop and Android emit | **done** (`5a2d318`) |
| 2 | extract `stateMachine/` from `session.ts` | none | **deferred** — see §7.1 |
| 3 | `codec/outgoingBody.ts` + `codec/incomingTopics.ts` seams; `createMultiDeviceSession` | none for `host-papp` | **done** (`27a2669`) |
| 4 | builder-as-size-oracle replaces `requestPayloadSize()` | none | **done** — folded into step 3 |

One observable change not anticipated above: the incoming query and subscription filter
moved from `matchAll: [topic]` to `matchAny: [topics]`. For a single topic the two are
semantically identical; `matchAny` is required to cover N device topics in one
subscription. `session.spec.ts:203` was updated to pin the new filter shape.

Steps 5–8 (desktop migration, RFC-0002 compaction seam) live in the companion
design.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Refactoring a 792-line session with subtle retry/expiry semantics | the 1581-line `session.spec.ts` is kept green at every step; the state machine extraction (step 2) changes no external behaviour |
| Enum index drift against Android | wire fixtures captured from Android, not hand-written |
| `unwrapOwn` premise is wrong | covered by a round-trip test: wrap for N recipients, unwrap as sender, assert plaintext equality |
| Multi-device sizing regressions | builder-as-oracle test asserting the measured length equals the submitted `data.length` |
