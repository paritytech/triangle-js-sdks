# RFC-0014: Get User Primary DotNS Name

|                 |                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------- |
| **Start Date**  | 2026-04-27                                                                                     |
| **Description** | Host API call returning the user's primary DotNS username, plus account-type cleanup           |
| **Authors**     | Valentin Sergeev                                                                               |

## Summary

This RFC defines a host API call, `host_get_user_id`, that returns the user's primary DotNS username scoped to the calling product. It also splits the existing `Account` type into a `ProductAccount` (no display name) and a `LegacyAccount` (with display name), and updates `host_account_get` and `host_get_legacy_accounts` accordingly. Together, these changes give products a single, unambiguous way to refer to a user by name and remove a misleading `name` field from product accounts where no human-chosen label exists.

This RFC supersedes RFC-0010 ("Host API root account access"), which was merged without review and conflicts with the original requirement of returning just a primary username.

## Motivation

Products need a way to link information to the user's identity and to refer to the user by a human-readable name (e.g. for greeting text, attribution in chat, profile UI, social features). The Host API today does not offer a clean primitive for this:

- The only username-shaped field reaching products is `Account.name`, returned both for product accounts (via `host_account_get`) and for legacy accounts (via `host_get_legacy_accounts`).
- Product accounts are protocol-derived from a `(DotNsIdentifier, DerivationIndex)` pair and have no inherent user-chosen label. Whatever a host puts into `Account.name` for a product account is therefore ambiguous and host-defined.
- Conversely, legacy accounts *do* have a user-chosen label (the user imported them and may have named them) and dropping it would regress UX.
- RFC-0010 attempted to address the username need by returning a full root account `{ public_key, name }`. This both leaks more information than the original requirement called for ("return the user's primary username") and re-introduces the `Account.name`/identity coupling we want to break.

This RFC realigns the protocol with the original requirement: a dedicated call that returns only a username, plus a type cleanup so that the presence of `name` on an account always means "user-chosen label."

## Stakeholders

- **Product developers** — need a stable primitive to display "who is the current user" without manually reverse-resolving public keys.
- **Host implementors / Account Holder team** — own the user-to-username mapping and the consent UX. The host has full latitude over how it chooses a primary username (single-name users, multi-name users, per-product distinct names, etc.).
- **End users** — gain explicit control over which username is exposed to which product and can, in sophisticated host implementations, present different identities to different products.

The RFC supersedes RFC-0010 (merged without review) and is published for fellowship review before any host or product implements it.

## Explanation

### Design Principles

1. **Username only.** The primitive returns a username, not a public key, not an address, not a full account. A product that needs signing or balances continues to use the existing account APIs.
2. **Product-scoped primary.** The host returns the username it considers primary *for this calling product*. The host MAY give every product the same username (the simplest implementation) or MAY allow the user to pick a different primary username per product.
3. **Source-agnostic.** Products MUST NOT assume anything about the source of the returned identifier. It might be a lite-person username, a full-person username, or a custom username the user owns. From the product's perspective it is just a `DotNsIdentifier`.
4. **No long-term invalidation contract.** The returned username reflects the host's state at the moment of the call. The user may later change which username this product sees as primary, in which case subsequent calls return the new value. There is no protocol-level mechanism to revoke a username already disclosed: a product may have cached or persisted it (possibly encrypted in local storage), and the host cannot reliably rescind that.

### New host call: `host_get_user_id`

```rust
fn host_get_user_id() -> Result<GetUserIdResponse, GetUserIdErr>

struct GetUserIdResponse {
    /// The user's primary DotNS username scoped to the calling product.
    primary_username: DotNsIdentifier
}

enum GetUserIdErr {
    /// User denied the disclosure request.
    PermissionDenied,
    /// User is not logged in (no account is connected).
    NotConnected,
    Unknown(GenericErr)
}
```

`DotNsIdentifier` is the existing type used elsewhere in the API (e.g. inside `ProductAccountId`), so no new identifier shape is introduced.

#### Behavior

1. **Connection precedence.** If no user account is connected, the host MUST return `NotConnected` without prompting. `NotConnected` strictly precedes `PermissionDenied`: a not-logged-in user cannot meaningfully authorize disclosure.
2. **Consent prompt.** If a user is connected and has not previously granted this product access to their primary username, the host MUST prompt the user. The prompt follows the existing Host API permission model: the user can grant the permission once or grant it persistently. If denied, the host returns `PermissionDenied`.
3. **Primary selection is the host's responsibility.** If the user is connected, the host MUST be able to select a primary username — the protocol guarantees this. Hosts that allow users to manage multiple usernames MAY surface a picker in the consent prompt; simpler hosts MAY return the user's only/canonical username. Products MUST NOT assume which strategy the host uses.
4. **Per-call freshness.** Each call returns the host's current view. If the user later reconfigures their primary username for this product, the next call returns the new value. The host SHOULD NOT serve a stale cached value to the product after the user has changed the underlying preference.
5. **Cross-product linkability.** Whether two products see the same `DotNsIdentifier` is a host implementation choice. First implementations are expected to return the same username to all products; more sophisticated hosts MAY let the user choose distinct primaries per product. The protocol does not constrain this.
6. **Sync semantics.** The signature is synchronous in the language-agnostic protocol description. Concrete bindings (TypeScript, Rust async, etc.) are free to expose this as `Promise`/`Future`/`Result` as appropriate; the protocol-level guarantee is only that exactly one of the listed result variants is delivered.

### Account type refactor

The current `Account` type carries an optional human-readable name:

```rust
pub struct Account {
    pub public_key: PublicKey,
    pub name: Option<String>,
}
```

This struct is reused across two semantically distinct return paths:

- `host_account_get(product_account_id) -> Account` — a protocol-derived account scoped to `(DotNsIdentifier, DerivationIndex)`. There is no point at which the user labels these.
- `host_get_legacy_accounts() -> Vec<Account>` — accounts the user imported into the Account Holder. The user may have given each one a name to distinguish them.

The `name` field is meaningful only in the second case. Keeping it in the first case forces hosts to either always return `None` (in which case it is dead weight) or fabricate a value (in which case its semantics become host-defined and ambiguous).

This RFC splits `Account` into two purpose-built types and updates the two callers:

```rust
/// A protocol-derived, product-scoped account. No user-chosen label.
pub struct ProductAccount {
    pub public_key: PublicKey,
}

/// An account the user imported into the Account Holder. May carry a
/// user-chosen label that distinguishes it from other imported accounts.
pub struct LegacyAccount {
    pub public_key: PublicKey,
    pub name: Option<String>,
}

fn host_account_get(
    product_account_id: ProductAccountId
) -> Result<ProductAccount, RequestCredentialsError>

fn host_get_legacy_accounts() -> Result<Vec<LegacyAccount>, RequestCredentialsError>
```

Note: the rename from `host_get_non_product_accounts` to `host_get_legacy_accounts` already happened in the v0.6→v0.7 migration; this RFC only updates the return type.

### Relationship to identity

After this RFC, the concerns separate cleanly:

- **"Who is the user?"** → `host_get_user_id`, returning a `DotNsIdentifier`.
- **"What product-scoped account should I sign with?"** → `host_account_get`, returning a `ProductAccount` (public key only).
- **"Which of the user's imported accounts should I act on?"** → `host_get_legacy_accounts`, returning `Vec<LegacyAccount>` (public key + user-chosen label).

A product that previously used `Account.name` from `host_account_get` to label "the user" should migrate to `host_get_user_id`.

## Drawbacks

1. **Breaking change.** Removing `name` from product-account responses breaks any product that reads it today. See [Compatibility](#compatibility) for the migration story and the alternative considered.
2. **Privacy surface.** A primary username is identifying. Products that previously had access only to opaque public keys now have a stable handle they can log, share, or correlate with off-chain data. The consent prompt is the only mitigation; this RFC does not propose protocol-level rate-limiting or auditing of disclosure.
3. **No revocation.** Once a username has been disclosed, a product can persist it indefinitely. A user changing their primary username only affects future products and future disclosures, not past ones. Products that need stronger guarantees should rely on session-scoped identifiers (e.g. contextual aliases) rather than the primary username.
4. **Ambiguous "no primary" case eliminated by fiat.** This RFC asserts that if the user is connected, the host MUST be able to pick a primary username. Hosts that cannot satisfy this (for instance, a brand-new user who has logged in but not yet registered any DotNS name) effectively must treat that state as `NotConnected`. This keeps the error surface small but pushes some host complexity into the connection-status model.

## Privacy

 First-call consent is mandatory. Hosts SHOULD persist the grant in line with the existing permission model (one-time vs persistent at the user's choice). Hosts SHOULD make it possible for users to inspect and change which products have been granted access; this RFC does not mandate that surface but assumes it exists in the broader Host UX.

## Performance, Ergonomics, and Compatibility

## Compatibility

This is a **breaking change** along two axes:

1. `host_account_get` no longer returns a `name` field. Products that read it today must migrate either to ignoring the username concern at this call site or to calling `host_get_user_id`.
2. `host_get_legacy_accounts` continues to return a `name` field but its element type changes from `Account` to `LegacyAccount`. This is a mechanical rename in any reasonably typed binding.

**Alternative considered (rejected): retain `Account` and return `name: None` from `host_account_get`.** This is wire-compatible — no product breaks at decode time, and any product reading `name` simply sees `None`. We rejected it because it preserves the exact semantic confusion this RFC is trying to remove: `Account.name` would still be reachable from product-account paths, would still be `Option<String>`, and a future host implementation could still populate it with an arbitrary host-defined value, restoring the original ambiguity. Splitting the types makes the misuse unrepresentable.

## Prior Art and References

- RFC-0010 (Host API root account access) — superseded by this RFC. RFC-0010 was merged without review and returns `{ public_key, name }`. It conflicts with the original product requirement of "return primary username only" and re-couples username retrieval to account retrieval, which this RFC explicitly decouples.
- v0.6 → v0.7 migration: the rename from `host_get_non_product_accounts` to `host_get_legacy_accounts` and the related "legacy account" terminology cleanup landed previously. This RFC builds on that vocabulary.
- Existing `host_account_get_alias` (contextual aliases) — the privacy-preserving alternative to a primary username when products do not need a user-readable handle.

## Future Directions

- **Host-driven username refresh notifications.** A subscription variant (`host_user_id_subscribe`) that pushes updates when the user changes their primary username, removing the need for products to re-poll.
