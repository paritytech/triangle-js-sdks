---
title: "Use ProductAccountId in Signing Methods"
type: rfc
status: draft
owner: "@valentin-parity"
pr:
---

# RFC 0005 — Use ProductAccountId in Signing Methods

|                 |                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------- |
| **Start Date**  | 2026-03-13                                                                                  |
| **Description** | Replace Address with ProductAccountId in host_sign_raw and host_sign_payload                |
| **Authors**     | Valentin Sergeev                                                                            |

## Summary

This RFC proposes changing `host_sign_raw` and `host_sign_payload` to use `ProductAccountId` instead of `Address` as the account identifier, aligning them with all other Host API account-related methods.

## Motivation

Currently, `host_sign_raw` and `host_sign_payload` identify the expected signer via `Address` (through `SigningPayloadRaw.address` and `SigningPayloadJSON.address`). This is inconsistent with the primary means of identifying a product account in the Host API — `ProductAccountId = (DotNsIdentifier, DerivationIndex)` — which is already used by:

- `host_account_get`
- `host_account_get_alias`
- `host_account_create_proof`
- `host_create_transaction`

This inconsistency introduces extra complexity on the host side, since `Address -> ProductAccountId` is an irreversible mapping without additional caching/lookup, making host implementations more error-prone. It also reduces ergonomics on the product side, as developers must manage two different identifier schemes for the same account.

## Detailed Design

### Status Quo

The current signing method signatures are:

```rust
struct SigningPayloadRaw {
    address: str,
    data: RawPayload
}

fn host_sign_raw(
    payload: SigningPayloadRaw
) -> Result<SigningResult, SigningErr>;
```

```rust
struct SigningPayload {
    address: str,
    block_hash: Vec<u8>,
    block_number: Vec<u8>,
    era: Vec<u8>,
    genesis_hash: GenesisHash,
    method: Vec<u8>,
    nonce: Vec<u8>,
    spec_version: Vec<u8>,
    tip: Vec<u8>,
    transaction_version: Vec<u8>,
    signed_extensions: Vec<str>,
    version: u32,
    asset_id: Option<Vec<u8>>,
    metadata_hash: Option<Vec<u8>>,
    mode: Option<u32>,
    with_signed_transaction: Option<bool>
}

fn host_sign_payload(
    payload: SigningPayload
) -> Result<SigningResult, SigningErr>;
```

For reference, `ProductAccountId` and related types are defined as:

```rust
type DotNsIdentifier = str;
type DerivationIndex = u32;
type ProductAccountId = (DotNsIdentifier, DerivationIndex);
```

### Proposed Changes

Replace the `address: str` field with `account: ProductAccountId` in both structs:

```rust
struct SigningPayloadRaw {
    account: ProductAccountId,  // changed from `address: str`
    data: RawPayload
}
```

```rust
struct SigningPayload {
    account: ProductAccountId,  // changed from `address: str`
    block_hash: Vec<u8>,
    block_number: Vec<u8>,
    era: Vec<u8>,
    genesis_hash: GenesisHash,
    method: Vec<u8>,
    nonce: Vec<u8>,
    spec_version: Vec<u8>,
    tip: Vec<u8>,
    transaction_version: Vec<u8>,
    signed_extensions: Vec<str>,
    version: u32,
    asset_id: Option<Vec<u8>>,
    metadata_hash: Option<Vec<u8>>,
    mode: Option<u32>,
    with_signed_transaction: Option<bool>
}
```

The method signatures themselves remain unchanged — only the payload struct fields are modified.

### Migration

Products currently using `address: str` in signing payloads will need to replace it with `account: ProductAccountId`. Since products already have access to their `ProductAccountId` (used in other Host API calls), this is a straightforward substitution.

## Drawbacks

- Products currently using `address` in signing payloads will need to migrate to `ProductAccountId`. This is a breaking change to the payload format.

## Alternatives

- Keep `address` and add `ProductAccountId` as an optional alternative field — rejected because it perpetuates the inconsistency and increases the API surface.
- Add a host-side `Address -> ProductAccountId` lookup — rejected because the mapping is irreversible without additional state, adding unnecessary complexity to the host.

## Unresolved Questions

None — the change is straightforward and aligns with existing conventions.

## References

- [Host API Design Document v0.5](https://docs.google.com/document/d/1AxKjF15y7gmdl-a6twc5wd8R5xcxKxMO8Ahp2l20v0g/edit?usp=sharing)
