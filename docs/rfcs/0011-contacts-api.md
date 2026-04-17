# RFC-0011: Contacts API

|                 |                                                                 |
| --------------- | --------------------------------------------------------------- |
| **Start Date**  | 2026-04-17                                                      |
| **Description** | Expose the user's contact list to products via Host API         |
| **Authors**     | Filippo Vecchiato                                               |

## Summary

Products can read the user's contact list. Each contact pairs local metadata with a context-scoped map keyed by DotNS path (the same identifier used for Ring VRF alias derivation). By default a product only sees entries for its own context; cross-context access is a separate privilege.

## Motivation

Products need to resolve human-readable identities to accounts. Without a contacts API, users must paste raw keys or scan QR codes for every interaction.

The host already manages a contact list. Exposing it:

1. **Removes friction** — products can show names instead of raw addresses.
2. **Enables cross-product identity** — multiple products resolve the same contact within their respective contexts.
3. **Preserves user control** — the host gates access and filters responses to the requesting product's scope.
4. **Supports contextual accounts** — a contact has different aliases and accounts per DotNS context, preserving unlinkability.

## Detailed Design

### Data Model

```rust
type ContactContext = ProductAccountId; // (DotNsIdentifier, DerivationIndex)

struct ContextContactInfo {
  alias: Option<Vec<u8>>,
  account_id: Option<AccountId>
}

struct LocalContactInfo {
  display_name: Option<str>
}

struct Contact {
  local: LocalContactInfo,
  entries: Map<ContactContext, ContextContactInfo>
}
```

`ContactContext` is a DotNS path — the same as Ring VRF contexts. `ContextContactInfo` fields are optional; either or both may be present.

### Access Tiers

#### Tier 1: Own-context (default)

The host filters `entries` to only the requesting product's DotNS path. `LocalContactInfo` is always included.

#### Tier 2: Cross-context (privileged)

Returns the full `entries` map. Required for products that aggregate identities across contexts (profile, honour).

### API

```rust
enum ContactsErr {
  NotConnected,
  Rejected,
  Unknown(GenericErr)
}

fn host_contacts_get() -> Result<Vec<Contact>, ContactsErr>;

fn host_contacts_subscribe(
  callback: fn(Vec<Contact>)
) -> Result<Subscriber, ContactsErr>;
```

Both require authentication (RFC-0009). The host prompts for permission before returning. `host_contacts_subscribe` delivers the full filtered list on each callback; hosts MAY debounce.

### Permission Model

Uses RFC-0002:

| Permission | Tier | Grants |
|-----------|------|--------|
| `Contacts` | 1 | Own-context entries + local info |
| `ContactsCrossContext` | 2 | Full entries across all contexts |

The tier 2 prompt SHOULD warn that the product can correlate contacts across contexts.

### Privacy-Preserving Display

The host can render a contact picker in a privileged overlay using full contact data, returning only the selected contact's own-context entry to the product. This lets users see rich details without the product receiving cross-context data. The overlay mechanism is host-specific and out of scope.

## Drawbacks

- **Privacy surface.** Even tier 1 reveals the user's social graph. The permission prompt mitigates but does not eliminate this.
- **Full-list delivery.** No per-contact queries. The overlay pattern partially addresses this for picker UIs.
- **Read-only.** Products cannot add contacts. Deferred intentionally.

## Alternatives

### A: Freeform context keys

Loses alignment with Ring VRF contexts and makes scoping ambiguous.

### B: Per-contact lookup by alias

Requires knowing the alias upfront; does not support browsing.

### C: No context scoping

Breaks unlinkability — any product could correlate aliases across all contexts.

## Unresolved Questions

1. **Honour.** Needs a protected path so UAs can display honour without exposing the alias to the product. Whether honour is per-product or universal (or both) needs design. Likely a separate RFC.
2. **Common triage contexts.** Should well-known contexts (profile, honour) have a lighter permission model?
3. **Contact mutation.** Write access deferred to a follow-up RFC.
4. **Filtered subscriptions.** Should tier 2 `host_contacts_subscribe` accept a context filter?
5. **Overlay specification.** The exact overlay mechanism needs its own spec.
6. **Pagination.** May be needed for large contact lists.
