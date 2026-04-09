---
title: "Statement Store Host API v0.2"
type: rfc
status: draft
owner: "@johnthecat"
pr:
---

# RFC 0008 — Statement Store Host API v0.2

## Summary

Three changes to the Statement Store Host API that unlock the full feature set of the underlying Substrate statement store: expressive topic filtering for subscriptions (AND / OR semantics), paged subscription delivery that exposes the historical-dump / live-stream boundary, and a new `remote_statement_store_request_allowance` call that lets a product provision an on-chain write allowance for its account via a host-mediated user-consent flow.

## Motivation

**Topic filtering.** The current `remote_statement_store_subscribe` start payload is a `Vector(Topic)` interpreted as MatchAll (AND): every listed topic must be present in a statement for it to be delivered. The underlying Substrate `TopicFilter` type also supports MatchAny (OR), but this is unexposed. Without OR semantics a product monitoring multiple independent channels must open one subscription per channel, multiplying connection overhead and complicating fan-in logic.

**Paged delivery.** The Substrate node delivers existing statements to a subscriber in pages before switching to incremental live updates. The current Host API collapses this into a flat `Vector(SignedStatement)` with no page boundary signal. Products cannot distinguish "receiving historical statements" from "receiving new live statements", making it impossible to show a meaningful loaded/synced state. The host is also forced to buffer the entire initial dump or deliver it in semantically meaningless chunks.

**Allowance management.** Before a product can submit a statement for a given account, that account needs an on-chain allowance set by the host. There is currently no Host API surface for a product to request this. A missing allowance causes `remote_statement_store_submit` to fail with `noAllowance` and leaves the product with no programmatic recourse.

## Detailed Design

### API changes

#### 1. TopicFilter type

A new SCALE enum used as the start payload for subscribe (V2):

```rust
enum TopicFilter {
  MatchAll(Vec<Topic>),   // AND: statement must contain every listed topic
  MatchAny(Vec<Topic>),   // OR:  statement must contain at least one listed topic
}
```

The `Any` (match-all) variant is intentionally omitted — receiving the full statement stream is too broad for any realistic product use case. Topic count limits (MatchAll ≤ 4, MatchAny ≤ 128 per Substrate) are left to the host to enforce; the protocol uses unbounded `Vec<Topic>`.

#### 2. Subscribe

The start payload changes from a flat topic list to `TopicFilter`, and the receive payload changes from a flat statement list to a page struct:

```
StatementStoreSubscribeV1_start   = TopicFilter
StatementStoreSubscribeV1_receive = SignedStatementsPage
```

Where:

```rust
struct SignedStatementsPage {
    statements: Vec<SignedStatement>,
    /// false — intermediate page of the initial historical dump; more pages follow.
    /// true  — initial dump is complete; product may render a "synced" state.
    ///         All subsequent pages are also isComplete = true and carry only new statements.
    isComplete: bool,
}
```

The host must preserve delivery order: all `isComplete = false` pages precede the first `isComplete = true` page; no `isComplete = false` page may be emitted afterwards.

#### 3. Allowance request

A new one-shot request/response pair:

```
StatementStoreRequestAllowanceV1_request  = ProductAccountId
StatementStoreRequestAllowanceV1_response = Result(_void, StatementStoreAllowanceErr)
```

```rust
enum StatementStoreAllowanceErr {
    /// Rejected by user
    Rejected,
    /// The product account is not derived from the product's registered dotNS identifier.
    InvalidDotNsIdentifier,
    Unknown(GenericErr),
}
```

Semantics:

- **Scope guard** — the host rejects immediately (without prompting) if the `DotNsIdentifier` in `ProductAccountId` does not match the calling product's registered dotNS identifier.
- **User consent** — the host presents a confirmation dialog analogous to the `remote_permission` flow, clearly stating which account will receive write access. On decline the host returns `Rejected`.
- **On-chain transaction** — on approval the host submits a `set_stmt_store_associated_account_id_at_slot` extrinsic. The host determines allowance parameters (`max_count`, `max_size`); the product does not specify them.
- **Caching** — a granted allowance is cached for the session; the same account does not re-prompt within a session.
- **Return value** — `Ok(())` means the allowance is set (or was already set). It does not guarantee submission will succeed if the statement exceeds the granted quota, but it eliminates the `noAllowance` failure mode.

### Data model changes

New SCALE codec definitions in `packages/host-api/src/protocol/v1/statementStore.ts`:

```typescript
// Subscribe

export const TopicFilter = Enum({
  MatchAll: Vector(Topic),
  MatchAny: Vector(Topic),
});

export const SignedStatementsPage = Struct({
  statements: Vector(SignedStatement),
  isComplete: bool,
});

export const StatementStoreSubscribeV1_start = TopicFilter;
export const StatementStoreSubscribeV1_receive = SignedStatementsPage;

// Allowance request

export const StatementStoreAllowanceErr = ErrEnum('StatementStoreAllowanceErr', {
  Rejected: [_void, 'Rejected'],
  InvalidDotNsIdentifier: [_void, 'Invalid dotNS identifier'],
  Unknown: [GenericErr, 'Unknown error'],
});

export const StatementStoreRequestAllowanceV1_request = ProductAccountId;
export const StatementStoreRequestAllowanceV1_response = Result(_void, StatementStoreAllowanceErr);
```

The `StatementStoreAdapter` interface in `packages/statement-store/src/adapter/types.ts` is updated:

```typescript
type TopicFilter =
  | { matchAll: Uint8Array[] }
  | { matchAny: Uint8Array[] };

type StatementsPage = {
  statements: Statement[];
  isComplete: boolean;
};

type StatementStoreAdapter = {
  queryStatements(filter: TopicFilter, destination?: Uint8Array): ResultAsync<Statement[], Error>;
  subscribeStatements(filter: TopicFilter, callback: (page: StatementsPage) => unknown): VoidFunction;
  submitStatement(statement: SignedStatement): ResultAsync<void, Error>; // error variants unchanged
};
```

`queryStatements` accepts a `TopicFilter` but returns a flat array — pagination only applies to the streaming subscription.

### Migration strategy

## Drawbacks

- **Breaking subscribe change** — all products and hosts must coordinate the upgrade.
- **isComplete handling burden** — products that render on receipt work naturally; those that wait for the full dataset must buffer until the first `isComplete = true` page.
- **Host controls allowance quota** — the product cannot guarantee the granted quota meets its needs; hosts must choose sensible defaults or expose configuration out-of-band.
- **Allowance round-trip latency** — `request_allowance` blocks until the extrinsic lands in a block. Products should call it early (e.g. at startup) rather than on the submission path.

## Unresolved Questions

- If an allowance already exists for the given account, should the host silently succeed, extend the allowance, or re-prompt? The proposal returns `Ok(())` without re-prompting but leaves the update policy open.
