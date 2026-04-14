---
title: "Sign In Host API"
owner: "@johnthecat"
---

# RFC 0010 — Sign In Host API

## Summary

A new `host_sign_in` method is added to the Accounts section of the Host API. It allows a product to programmatically trigger the host's sign-in flow and receive a result indicating whether sign-in succeeded, was already in effect, or was rejected by the user.

## Motivation

Products sometimes need to operate in two modes: an unauthenticated mode (browsing, previewing, informational views) and an authenticated mode (on-chain actions, personalised content). The natural UX pattern is to let the user reach a meaningful decision point before asking them to sign in, rather than forcing a connection gate at launch.

The existing API has no way to satisfy this pattern from the product side. `host_account_connection_status_subscribe` lets a product observe connection state reactively, but provides no mechanism to initiate the connection flow. `host_account_get` returns `RequestCredentialsErr::NotConnected` when the account is unavailable — a dead end that forces the product to direct the user out-of-band to the host application.

`host_sign_in` fills this gap: a product can let the user reach the right moment, call `host_sign_in`, wait for the result, and then proceed with account operations without leaving the product context.

## Detailed Design

### API changes

A single new method and its result types are added to the Accounts section, positioned after `host_account_connection_status_subscribe`:

```rust
enum SignInErr {
  /// The user explicitly dismissed or cancelled the sign-in flow.
  Rejected,
  /// An unexpected condition prevented sign-in from completing.
  Unknown(GenericErr),
}

enum SignInResult {
  /// Sign-in completed successfully. The account is now available.
  Success,
  /// The host was already connected. No sign-in UI was shown.
  AlreadySignedIn,
}

fn host_sign_in() -> Result<SignInResult, SignInErr>;
```

The call is a one-shot request: the product awaits the response and the host resolves it only when the sign-in flow concludes. The host determines which account to connect based on its own context; no parameters are accepted.

If the host is already in the `Connected` state when `host_sign_in` is called, it returns `Ok(AlreadySignedIn)` immediately without presenting any UI. Products may call `host_sign_in` without checking connection status first; `AlreadySignedIn` is a normal, non-error outcome.

If `host_sign_in` is called while a sign-in flow is already in progress, the host MUST deduplicate the requests: the second call joins the in-progress flow and resolves with the same outcome.

Platform-specific behaviour:

- **Desktop / Web hosts** — the host initiates the Polkadot mobile pairing flow (e.g. presents a QR code or deep-link for the user to approve from their mobile device).
- **Polkadot Mobile host** — the account is always present; the host returns `Ok(Success)` immediately without showing any UI.

A successful sign-in (`Ok(Success)`) MUST cause `host_account_connection_status_subscribe` to emit `AccountConnectionStatus::Connected` to all active subscribers. `Ok(AlreadySignedIn)` does not emit a new event. When the result is `Ok(Success)`, a subsequent `host_account_get` for a valid `ProductAccountId` is guaranteed not to return `RequestCredentialsErr::NotConnected`.

### Data model changes

New SCALE codec definitions in `packages/host-api/src/protocol/v1/accounts.ts`:

```typescript
export const SignInErr = Enum({
  Rejected: _void,
  Unknown: GenericErr,
});

export const SignInResult = Enum({
  Success: _void,
  AlreadySignedIn: _void,
});

export const host_sign_in_response = Result(SignInResult, SignInErr);
// host_sign_in carries no request payload
```

### Migration strategy

`host_sign_in` is a new addition with no changes to existing methods or types. No migration is required. Hosts that do not yet implement this method should return `Unknown(GenericErr)` for the call.

## Drawbacks

- **Adds a second connection path.** The host now has two code paths that can transition the account connection state: the host's own UI and `host_sign_in`. Host implementations must ensure these paths compose correctly (deduplication, state machine consistency).
- **Blocking call during long flows.** On Desktop/Web the pairing flow can take several seconds or more. The product must hold its own UI in a loading/pending state for the duration, with no progress signal during the wait.
