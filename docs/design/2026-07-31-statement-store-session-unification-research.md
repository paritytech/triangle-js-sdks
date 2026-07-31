# Statement-store session unification — research report

**Date:** 2026-07-31
**Status:** research / pre-design. No design approved yet.

## Sources read

| Source | Location | Revision |
|---|---|---|
| Spec | `github.com/paritytech/chat-spec` — `base-spec.md` (v0.16), `mds.md` (v0.2), RFC-0001 (merged), RFC-0004 (merged), RFC-0002 + RFC-0003 (open PRs #4, #5) | `134cad7` |
| SDK | `triangle-js-sdks/packages/statement-store` (+ `host-papp`, `host-chat`) | `d8c72c5` (0.9.0) |
| Desktop | `polkadot-browser/src/domains/{chat/p2p, device-sync, device-session, application/statement-store}` | `6e1e83f2`, branch `feat/sdk-v0.9-migration` |
| Android | `polkadot-app-android-v2/feature/statement-store` (+ `chats`, `sso`, `device-sync`) | `36591118a`, branch `master` |

---

## 1. Executive summary

The four implementations are **already ~95% wire-identical**. Session-id derivation, channel derivation, expiry layout and monotonicity, statement overhead accounting, proof format, and the two-layer envelope crypto *structure* all agree byte-for-byte. There is no protocol re-derivation work here.

What actually differs is three things, in descending order of difficulty:

1. **Crypto primitives.** SDK 0.9 + desktop are on X25519 + ChaCha20-Poly1305 (RFC-0004). Android `master` is still on P-256 + AES-256-GCM. RFC-0004 declares itself a deliberate flag day with "no dual-format negotiation, no versioned cipher-suite field, and no migration path". **"Backward compatible with Android" and "conformant with the spec" are mutually exclusive on this axis today.** This is the one blocking decision (§7).
2. **`StatementData` enum arity.** SDK has 2 variants; Android and desktop have 4. This is the "2 additional enum variants" in the brief. Additive, index-safe, low risk.
3. **Session lifecycle model.** Android has a clean, spec-traceable state machine with pluggable wire-format seams. The SDK has a 792-line imperative closure. Desktop has no state machine at all plus a 914-line reimplementation with a localStorage outbox that — as shown in §5 — is not needed.

**Recommendation:** port Android's *architecture* (state machine + `OutgoingBodyBuilder` / `IncomingTopicsProvider` / `StatementDecoder` seams) into `packages/statement-store`, keep the SDK's *policies* (app-driven ACK codes, `neverthrow` error surface, retry/allocator discipline), and delete desktop's `chatSessionV2.ts` + `multi-device/service.ts` in favour of the SDK. Android is the reference for structure; the SDK is the reference for correctness detail.

---

## 2. What is already identical (do not touch)

| Concern | SDK | Android | Desktop | Spec |
|---|---|---|---|---|
| `SessionId = khash(K, "session" : accA : accB : "/" pinA : "/" pinB)` | `model/session.ts:14` | `CommunicationTopicDerivation.kt` + `SessionIdParams.kt` | uses SDK | base-spec §Discovery |
| Channel = `khash(topic, "request"\|"response")` | `session.ts:785-791` | `StatementChannels.kt` | `chatSessionV2.ts:217,224` | base-spec §Sending Requests |
| Expiry = `0xFFFFFFFF << 32 \| secondsSince(1_763_164_800)`, `max(prev+1, now)` | `submit/allocator.ts` | `StatementExpiry.kt` + `StatementTimestamp.kt` | uses SDK allocator | base-spec §Priority |
| Statement overhead = `32+32+8+64+32 = 168` | `session.ts:77` | `CommunicationState.kt:12` | (n/a, measures final bytes) | — |
| Proof = sr25519 over `Field`-prefixed encoding | `statementProver.ts` | `KeypairSigningStatementStoreMessageProver.kt` | uses SDK | base-spec §statement-proof |
| Outer envelope = `KDF(ECDH)` → AEAD, framing `nonce(12) ‖ ct ‖ tag(16)` | `session/encyption.ts` (HKDF-SHA256 → ChaCha20) | `RealCommunicationEncryption.kt` (HKDF-SHA256 → AES-GCM) | uses SDK | Appendix A + RFC-0004 |
| Inner one-shot key used **raw** (no KDF) | — | `MultiDeviceEnvelopeEncryption.kt` | `multi-device/service.ts:73-83` | mds.md §Sending P2P Messages |
| Per-device wrap = `KDF(ECDH(senderDevicePriv, recipientDevicePub))` → AEAD | — | `deriveEnvelopeAesKey` | `wrapOneShotKey` | mds.md |

The topic key is the **raw** ECDH output; the AEAD key is the **HKDF-SHA256** of it. All three get this right and agree.

---

## 3. Divergence 1 — `StatementData` enum arity

```
SDK    packages/statement-store/src/session/scale/statementData.ts
       StatementData = Enum({ request: 0, response: 1 })

Android feature_statement_store_impl/data/models/scale/StructuredStatementData.kt
Desktop src/domains/chat/p2p/requests/schemas.ts
       StructuredStatementData = Enum({
         Request: 0, Response: 1, MultiRequest: 2, MultiResponse: 3 })

MultiRequest  { encryptedRequest:  Bytes, devicesInfo: Vec<RequestDeviceInfo> }
MultiResponse { encryptedResponse: Bytes, devicesInfo: Vec<RequestDeviceInfo> }
RequestDeviceInfo { statementAccountId: [u8;32], encryptedKey: Bytes }
```

Matches mds.md §"Sending P2P Messages" exactly. Indices 0/1 are unchanged, so **adding 2/3 to the SDK is purely additive** — existing host-papp SSO V1 channels are byte-identical before and after. An SDK decoder today throws on tag 2/3; after the port it decodes them transparently.

Note one Android-specific wire detail already matched by desktop (`requests/schemas.ts:118-125`): `RequestDeviceInfo.statementAccountId` is a **fixed** `[u8;32]`, not `Vec<u8>`. Pre-#605 Android APKs emit `Vec<u8>`; those builds cannot complete the handshake anyway. Port the fixed form.

---

## 4. Divergence 2 — crypto primitives (the blocking one)

| | Key agreement | AEAD | Pubkey size |
|---|---|---|---|
| Spec (RFC-0004, merged 2026-07-24) | X25519 | ChaCha20-Poly1305 | 32 B |
| SDK 0.9 | X25519 (`@noble/curves`) | ChaCha20-Poly1305 | 32 B |
| Desktop (`feat/sdk-v0.9-migration`) | X25519 | ChaCha20-Poly1305 | 32 B |
| **Android `master`** | **P-256 (`Secp256r1KeyGenerator`)** | **AES-256-GCM (`MessageEncryption.aes`)** | **65 B** |

Grepping the Android tree for `x25519` / `chacha` returns **zero** hits. Android has not started RFC-0004.

RFC-0004 §Compatibility:

> Breaking, by design, and deliberately unmitigated: the protocol is pre-launch. This is a flag-day swap... No dual-format negotiation, no versioned cipher-suite field, and no migration path is specified... All clients, PApp, and any test on-chain identity records must move together in a coordinated release.

So there is nothing to be "backward compatible" with here — the spec forbids the compatibility shim. The good news: **the primitive swap is orthogonal to everything else in this report.** The structure (`KDF(ECDH) → AEAD`, `nonce ‖ ct ‖ tag`, key/nonce/tag sizes) is unchanged; only the two function pointers move. Isolating them behind an injected `CryptoSuite` costs ~40 lines and makes the flag day a config flip rather than a fork.

---

## 5. Divergence 3 — session lifecycle model

### 5.1 Android (the reference structure)

```
RealCommunicationSession          ← driver: side-effects → I/O, event flow out
 ├─ StateMachine
 │    Initialization  ← spec §"Session Initialization Phase"
 │    Active          ← spec §"Session Active Phase"
 │    (pure: events in, (state, side-effects) out — 523-line unit test)
 └─ CommunicationTransport
      ├─ OutgoingBodyBuilder      [SingleRequest | MultiDevice]   ← wire format seam
      ├─ IncomingStatementsStream
      │    └─ IncomingTopicsProvider [identityTopicOnly | multiDeviceTopics]
      │         (a Flow — re-subscribes when the peer's device roster changes)
      └─ StatementDecoder          (Single/Multi transparent; decode + decodeOur)
```

Fixed at construction, never branched on at runtime. One `CommunicationSession` serves chat, SSO, device-sync, and videogame.

### 5.2 SDK (`session.ts`, 792 lines)

Correct on many details Android glosses over, but the phase machine is an ad-hoc `state.phase` string plus scattered guards. Strengths worth keeping:

- App-driven response codes (`submitResponseMessage` / `respondToRequests`) — **spec-conformant**; Android hardcodes `PROTOCOL_ACK_CODE = 0` and so cannot express `ApplicationError.invalidMessage = 100`.
- `submitWithRetry` with unbounded priority retries + `raiseFloor` (`submit/retry.ts`) — a genuinely subtle piece neither other implementation has.
- NACK of decrypted-but-undecodable requests via `recoverRequestId` (`session.ts:126-136`).
- Dedup of identical in-flight messages with token fan-out.

Weaknesses:

- `state.incomingRequests` is a `Map`, but the spec (and Android) have exactly **one** `IncomingRequest`. The SDK's own comment at `session.ts:614-618` concedes the shared response channel only ever exposes the latest response, so the Map cannot be honoured. Drop it.
- Init does `queryStatements(outgoing) + queryStatements(incoming)` and only *then* subscribes (`session.ts:453,421`) — a race window the spec's single `matchAny` subscription + initial-dump design exists to close.
- Sizing measures the encoded `StatementData` **before** encryption, so it ignores AEAD expansion and (once multi-device lands) per-device fan-out growth.

### 5.3 Desktop (`chatSessionV2.ts`, 914 lines)

No state machine; a hand-rolled batch + parked-queue + localStorage outbox. **The outbox rests on a false premise.** `chatSessionV2.ts:278-284`:

> Our own MultiRequest inner is unreadable to us (the one-shot key is wrapped for recipient devices only), so unlike the SDK's init() we can't rebuild the batch from the store — the persisted record IS the source.

The wrap is `X25519(senderDevicePriv, recipientDevicePub)`. The sender can re-derive that identical secret for **any** recipient device it wrapped for, so its own envelope is fully readable. Android does exactly this — `MultiDeviceEnvelopeEncryption.unwrapOwn()`, reached via `StatementDecoder.decodeOur()` → `CommunicationTransport.fetchOutgoing()`. The outer layer is likewise self-decryptable (same key used to encrypt).

Consequence: adopting Android's `decodeOur` deletes desktop's entire outbox subsystem — persistence, `coverage` map + pruning, `notified` flags, drain-retry timer, and the `DataTooLarge` rollback dance — roughly 250 lines, and restores the spec's model where the store holds `OutgoingRequest` and the app DB holds `MessageQueue` (base-spec §"Application Layer Lifecycle": re-mark sent-but-absent `LocalMessage`s as `new`).

Desktop's one genuine advantage: `buildEnvelope()` trial-builds the **final encrypted bytes** and measures those (`chatSessionV2.ts:388-398`). That is the only correct sizing method under multi-device, because envelope size grows with the peer's roster. Keep it.

### 5.4 Subscription model

| | Shape | Cost at N contacts × M devices |
|---|---|---|
| Spec | one sub, `matchAny([SessionId(A,B), SessionId(B,A)])`, init consumes initial dump until `remaining = 0` | 1 per peer |
| Android | `matchAny(all peer-device topics)`, re-opened via `flatMapLatest` on roster change | 1 per peer |
| SDK | 2 queries + 1 `matchAll(incoming)` sub | 1 per peer (+ race) |
| **Desktop** | **one subscription per peer device** (`chatSessionV2.ts:880`) | **N × M**, guarded by a 120-subscription budget counter (`subscription-registry.ts`) |

Desktop's model does not scale and its budget guard is a symptom, not a fix. Adopt Android's `matchAny` + observable topic set.

### 5.5 Sizing / budget

| | Measures | Budget |
|---|---|---|
| SDK | encoded `StatementData` pre-encryption | `4096 − 168` |
| Android | **raw message byte sum** (ignores SCALE framing, AEAD expansion, envelope fan-out) | `maxStatementSize − 168` |
| Desktop | final encrypted bytes (trial build) | `(500 − 2) × 1024` |

Only desktop's method is sound. The budget constant itself needs one authoritative source — the spec suggests 4 KB for chat, desktop assumes ~498 KB; `DataTooLargeError.available` is the chain's answer and should seed it.

---

## 6. Other transports that should collapse onto the same session

Desktop currently has **four** hand-rolled statement transports; Android has one.

| Desktop file | LOC | What it is |
|---|---|---|
| `chat/p2p/chatSessionV2.ts` | 914 | per-peer multi-device chat session |
| `chat/p2p/session-transport/gateway.ts` | 447 | identity-channel + device-channel fire-and-forget (no session state) |
| `device-sync/transport.ts` | 182 | device↔device WebRTC signaling over statements |
| `device-session/service.ts` | 67 | — |

All four derive the same topics with the same helpers and submit through the same allocator. Under the Android layering they are one session parameterized by `(OutgoingBodyBuilder, IncomingTopicsProvider)`. `host-chat/src/session.ts` in the SDK is currently a stub with the entire real implementation commented out — it is the natural home for the chat-level layer once the transport lands.

---

## 7. Proposed target architecture

```
packages/statement-store/src/session/
  stateMachine/
    states.ts          Initialization | Active            ← pure, spec-traceable
    events.ts          SubmitMessage | InitialDataFetched | RequestReceived | ...
    sideEffects.ts     FetchInitialData | SubmitRequest | SubmitResponse | ...
  session.ts           driver: side-effects → transport, events → subscribers
  transport.ts         fetchOutgoing / fetchIncoming / subscribe / submit
  codec/
    outgoingBody.ts    OutgoingBodyBuilder  [single | multiDevice]
    incomingTopics.ts  IncomingTopicsProvider [identityOnly | multiDevice(observable)]
    decoder.ts         StatementDecoder     (Single/Multi; decode + decodeOwn)
  scale/statementData.ts   + multiRequest(2), multiResponse(3)
  crypto/suite.ts      CryptoSuite { keyAgreement, aead }  ← RFC-0004 swap point
```

Public surface:

```ts
createSession(...)              // single-device — byte-identical to today
createMultiDeviceSession(...)   // + envelope builder, roster-driven topics
```

Policy decisions carried over from the SDK, not Android: app-driven response codes (auto-ACK offered as an opt-in wrapper, matching what chat wants), `neverthrow` results, `submitWithRetry` + `raiseFloor`, undecodable-request NACK.

---

## 8. Migration plan

Each step is independently shippable and independently revertible.

| # | Step | Risk | Compat impact |
|---|---|---|---|
| 0 | Extract `CryptoSuite` in the SDK; X25519+ChaCha20 stays the default | low | none |
| 1 | Add `multiRequest`/`multiResponse` to `StatementData`; add `StatementDecoder` that unwraps them transparently | low | additive — SDK gains the ability to *read* Android/desktop wire |
| 2 | Extract the state machine from `session.ts` behind the unchanged `Session` interface; port Android's `ActiveStateTest` cases | medium | none — existing 1581-line `session.spec.ts` is the harness |
| 3 | Add `OutgoingBodyBuilder` + `IncomingTopicsProvider` seams; `createSession` keeps single-device defaults; add `createMultiDeviceSession` | medium | none for host-papp |
| 4 | Replace byte-count sizing with trial-build sizing; source the budget from `DataTooLargeError.available` | low | none |
| 5 | Desktop: swap `chatSessionV2` → SDK multi-device session; delete the outbox, per-device subscriptions, `multi-device/service.ts` | high | desktop-internal only |
| 6 | Desktop: move `session-transport/gateway.ts` identity/device channels onto the same session | medium | desktop-internal |
| 7 | Fold `device-sync/transport.ts` + `device-session/service.ts` in | medium | desktop-internal |
| 8 | RFC-0002 compaction as a `MessageCompactor` port on the state machine (Android's `CommunicationSideEffect.Compact` is the seam to copy) | medium | additive, `MessageContent` index 19 |

Steps 0–4 are SDK-only and change no bytes on the wire. Step 5 is where the desktop win lands (~1,100 lines deleted).

---

## 9. Backward-compatibility matrix

| Axis | Compatible with Android today? | Compatible with spec? |
|---|---|---|
| Topics, channels, expiry, proof | ✅ unchanged | ✅ |
| `StatementData` tags 0/1 | ✅ unchanged | ✅ |
| `StatementData` tags 2/3 | ✅ once ported (matches Android's wire, incl. fixed-32 `statementAccountId`) | ✅ mds.md |
| Envelope structure (one-shot key + per-device wrap) | ✅ | ✅ |
| **Cipher suite** | ❌ P-256/AES vs X25519/ChaCha20 | ✅ SDK/desktop already conformant; Android is not |
| `MessageContent` indices 0–20 | ✅ desktop's `session-transport/schemas.ts` already carries all of them + the iOS `iosVoIP` platform variant the SDK's 2-variant `Platform` codec chokes on | ⚠️ SDK's `host-chat` `Platform` codec needs the third variant |

One concrete SDK bug fall-out: `host-chat/codec/message.ts` declares `Platform = Status('Android','iOS')`; iOS PApp emits a third variant for VoIP tokens, which throws `Unknown status index: 2`. Desktop already forked the codec to work around it (`session-transport/schemas.ts:1-30`). Fix in the SDK and delete the fork.

---

## 10. Open question (blocking the design)

The brief asks to "keep backward compatibility with Android **and** spec". On the cipher suite those two are contradictory, and the spec explicitly forbids the shim that would reconcile them. Three ways out:

**(a) Coordinated flag day.** Android ships RFC-0004 in the same release. SDK hardcodes X25519+ChaCha20. Simplest, spec-conformant, matches RFC-0004's stated intent. Requires the Android team's schedule.

**(b) Dual-suite SDK with negotiation.** Contradicts RFC-0004 §Compatibility, and no negotiation mechanism exists in the protocol to build on. Would need a spec change first (per `CLAUDE.md`: spec leads, implementation follows). Not recommended.

**(c) Unify structure now, sequence the flag day separately.** Land steps 0–7 with the `CryptoSuite` seam so *both* suites are constructible (useful for cross-client integration tests against Android's current build), but ship exactly one suite per deployment — no runtime negotiation. Decouples the architectural work from the Android schedule.

Recommendation: **(c)**, converging on **(a)** when Android is ready.
