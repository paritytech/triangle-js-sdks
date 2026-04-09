---
title: "Payments Feature Design"
created: 2026-04-08
rfc: docs/rfcs/0006-payments.md
status: approved
---

# Payments Feature Design

## Overview

Implements RFC-0006: four host API calls that allow products to query balances, top up, and request payments through an abstract interface.

## Protocol additions

Four new methods are inserted **after `remote_preimage_submit`** (after the Preimage lookup section) and before Chain interaction, in this exact order (serialization index order matters):

1. `host_payment_balance_subscribe` — subscription
2. `host_payment_top_up` — request
3. `host_payment_request` — request
4. `host_payment_status_subscribe` — subscription

## Codec types (`packages/host-api/src/protocol/v1/payments.ts`)

| Type | Encoding |
|------|----------|
| `Balance` | `u128` (bigint) |
| `PaymentId` | `str` |
| `Ed25519PrivateKey` | `Bytes(32)` |
| `PaymentTopUpSource` | `Enum { ProductAccount(ProductAccountId), PrivateKey(Bytes(32)) }` — import `ProductAccountId` from `accounts.ts` |
| `PaymentBalance` | `Struct { available: u128, pending: u128 }` |
| `PaymentReceipt` | `Struct { id: str }` |
| `PaymentStatus` | `Enum { Processing, Completed, Failed(str) }` |
| `PaymentBalanceErr` | `ErrEnum { PermissionDenied, Unknown(GenericErr) }` |
| `PaymentTopUpErr` | `ErrEnum { InsufficientFunds, InvalidSource, Unknown(GenericErr) }` |
| `PaymentRequestErr` | `ErrEnum { Denied, InsufficientBalance, Unknown(GenericErr) }` |
| `PaymentStatusErr` | `ErrEnum { PaymentNotFound, Unknown(GenericErr) }` |

Codec action names follow the standard derivation algorithm:
- `host_payment_balance_subscribe_{start,stop,interrupt,receive}`
- `host_payment_top_up_{request,response}`
- `host_payment_request_{request,response}`
- `host_payment_status_subscribe_{start,stop,interrupt,receive}`

## host-api package changes

- **`packages/host-api/src/protocol/v1/payments.ts`** — new file with all codec definitions
- **`packages/host-api/src/protocol/impl.ts`** — register 4 new entries after `remote_preimage_submit`
- **`packages/host-api/src/hostApi.ts`** — add 4 new methods: `paymentBalanceSubscribe`, `paymentTopUp`, `paymentRequest`, `paymentStatusSubscribe`
- **`packages/host-api/src/index.ts`** — export payment codec types

## Container changes (`packages/host-container`)

**`packages/host-container/src/types.ts`** — add to `Container`:
- `handlePaymentBalanceSubscribe` — subscription handler
- `handlePaymentTopUp` — request handler
- `handlePaymentRequest` — request handler
- `handlePaymentStatusSubscribe` — subscription handler

**`packages/host-container/src/createContainer.ts`** — add 4 slots:
- `handlePaymentTopUpSlot` — `makeNotImplementedSlot` → `PaymentTopUpErr.Unknown`
- `handlePaymentRequestSlot` — `makeNotImplementedSlot` → `PaymentRequestErr.Unknown`
- `handlePaymentBalanceSubscribeSlot` — `makeInterruptSlot`
- `handlePaymentStatusSubscribeSlot` — `makeInterruptSlot`

## Product SDK changes (`packages/product-sdk`)

**`packages/product-sdk/src/payments.ts`** — new file:

```ts
type TopUpSource =
  | { type: 'productAccount'; dotNsIdentifier: string; derivationIndex: number }
  | { type: 'privateKey'; key: Uint8Array }

type PaymentStatus =
  | { type: 'processing' }
  | { type: 'completed' }
  | { type: 'failed'; reason: string }

createPaymentManager(transport?) → {
  subscribeBalance(callback: (balance: { available: bigint, pending: bigint }) => void): Subscription
  topUp(amount: bigint, source: TopUpSource): Promise<void>
  requestPayment(amount: bigint, destination: Uint8Array): Promise<{ id: string }>
  subscribePaymentStatus(id: string, callback: (status: PaymentStatus) => void): Subscription
}

export const paymentManager = createPaymentManager()
```

**`packages/product-sdk/src/index.ts`** — export types and `createPaymentManager`, `paymentManager`

## Tests (`__tests__/hostApi/payments.spec.ts`)

Uses `createHostApiProviders()` mock bus. Test cases:

**`host_payment_balance_subscribe`**
- Balance update delivered to callback
- Interrupt triggers when no handler set

**`host_payment_top_up`**
- Success: returns ok
- Error: `InsufficientFunds`
- Error: `InvalidSource`

**`host_payment_request`**
- Success: returns receipt with id string
- Error: `Denied`
- Error: `InsufficientBalance`

**`host_payment_status_subscribe`**
- Delivers `Processing` then `Completed` in sequence
- Error: `PaymentNotFound` on interrupt

## Protocol doc changes (`docs/design/host-api-protocol.md`)

1. Add v0.8 changelog entry
2. Add 4 payment methods to the General Interface section (after preimage lookup)
3. Add "Payments" section after "Preimage lookup" with type definitions and method docs
4. Add "Interface" sub-entries for all payment-related error enums and structs

## README updates

Update `packages/host-container/README.md` and `packages/product-sdk/README.md` with payment API entries, matching style of existing sections.
