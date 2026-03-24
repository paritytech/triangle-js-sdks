---
title: "Coinage Host API for Private Payments"
type: rfc
status: draft
owner: "@valentin-parity"
pr:
---

# RFC 0003 — Coinage Host API for Private Payments

|                 |                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------- |
| **Start Date**  | 2026-03-13                                                                                  |
| **Description** | Host API extensions enabling products to query coinage balances and request private payments |
| **Authors**     | Valentin Sergeev                                                                            |

## Summary

This RFC proposes host API extensions that allow products to interact with the coinage private-payment system. It introduces two capabilities: querying a user's coinage balance (split into spendable and pending amounts) and requesting payments via the existing chat communication channel.

## Motivation

Coinage is a system that facilitates private payments by utilising a UTXO-like model with "anonymity" checkpoints powered by RingVRF membership proofs. More information can be found in the [coinage design document](https://docs.google.com/document/d/124mp6mnMhKFgSjmL6Y1NDzD0v-hRAhmryjqWEJ7yFDk/edit?usp=sharing).

The main premise of coinage is to make it impossible to trace money flows or determine the total holdings of any person. On the other hand, products may be interested in using coinage to facilitate payment-related features. Thus, we want to provide them with the opportunity to interact with the coinage system.

Products have two core needs:

- **Balance visibility** — understanding the total balance of the user in order to display appropriate UI and apply validations.
- **Payment reliability** — requesting a payment and receiving a guaranteed result once the payment is authorised by the user.

## Detailed Design

### Coinage Context

This section provides a high-level understanding of the coinage implementation on the user-facing side (e.g. mobile app):

1. The app must maintain a collection of coins, each coin corresponding to a single unspent on-chain coin with a fixed denomination. Each coin is 1:1 associated with an account that is considered the coin holder.
2. When Alice wants to transfer a coin to Bob, she does not perform any on-chain actions. Instead, she transmits the private keys corresponding to the set of coins that together constitute the transfer amount. Bob then needs to generate new keys for each coin and execute an on-chain transaction that changes coin ownership from Alice's keys (now also known to Bob) to Bob's keys (which only Bob knows the private keys of).
3. Each coin has an age. Age is 0 after initial onboarding and increases by one after each subsequent transfer. When age reaches a certain threshold, the coin must be recycled — it gets exchanged for a ZK voucher that can later be redeemed, breaking the connection between the old coin and a new one. ZK redeeming is not instantaneous and requires some time.
4. It is possible to split bigger coins into smaller ones.
5. Coins are immutable — when we refer to "age increase" or other "mutations", it actually means that the old coin(s) have been burned and new one(s) minted with updated parameters.

### Balance Fetch

We define the following host API call:

```ts
host_payment_balance(): Result<PaymentBalanceResult, PaymentBalanceErr>

PaymentBalanceResult = {
    spendable: Balance // part of the coinage balance that can be spent right now
    pending: Balance   // part of the coinage balance that the user possesses but cannot spend right now (in recycling stage)
}

enum PaymentBalanceErr = {
    PermissionDenied
}
```

The host implementation is expected to explicitly ask the user whether they want to grant a product access to their balance.

### Transfer

Given the off-chain nature of coinage-related transfers, a stateful communication channel between a product and the user is required. We propose to use **chat** as the communication channel:

- Chat is already integrated into the host API.
- The mobile app coinage implementation will also utilize chat for the same exact purpose.

We define the following host API call:

```ts
host_payment_request(amount: Balance): Result<PaymentRequestResult, PaymentRequestErr>

PaymentRequestResult = {
    payment_id: str
}

enum PaymentRequestErr = {
    Rejected
}
```

We also extend `ChatMessageContent` to support a payment message:

```ts
enum ChatMessageContent = {
    // existing types
    Payment(keys: Vec<Ed25519PrivateKey>, amount_hint: Balance, payment_id: str)
}
```

### Behavior

The host implementation should make a best effort to ensure that once a `payment_id` has been returned as part of `PaymentRequestResult`, the product can expect a corresponding `ChatMessageContent::Payment` to arrive later. Even if the user accidentally kills the current session, the message (as with all other yet-unseen chat messages) should arrive to the product.

In `ChatMessageContent::Payment`, `amount_hint` must be interpreted merely as a hint for the product to immediately display the potential amount with some "detecting payment" state. The product **MUST** query on-chain state to understand the actual total sum of all coins passed, as well as validate that they exist.

### Assumptions

This proposal implicitly assumes that the coinage asset (e.g. pUSD) is fixed and is known to both the host and the product, so that `Balance` can be correctly interpreted according to the asset's decimals.

### Stakeholders

- **Product developers** — consumers of the host API who wish to integrate coinage-based payments into their applications.
- **Mobile app / host implementors** — responsible for implementing the host-side logic including user consent flows, coin management, and chat integration.
- **End users** — whose privacy must be preserved while enabling product interactions with their coinage balance.

### Testing, Security, and Privacy

- **Testing**: Implementations should verify that `payment_id` lifecycle is correctly maintained across session interruptions, that balance queries respect user consent, and that `amount_hint` values are validated against on-chain state.
- **Security**: Products MUST validate coin existence and ownership on-chain rather than trusting `amount_hint`. The user consent flow for balance queries must be robust against repeated prompting attacks.
- **Privacy**: Balance queries expose the user's total coinage holdings to the requesting product. The host must ensure explicit user consent before disclosing this information. Payment flows must not leak additional metadata beyond what is necessary for the transfer.

### Performance, Ergonomics, and Compatibility

#### Performance

The off-chain nature of coin transfers minimizes on-chain overhead. The recycling stage introduces latency for coins that have reached the age threshold, reflected in the `pending` balance field. Smart-contract interactions require an additional unload step which adds latency compared to direct on-chain transfers.

#### Ergonomics

The current proposal provides a low-level interface. More convenient, higher-level abstractions will be needed to provide a more ergonomic interface and better developer experience for product developers.

#### Compatibility

This proposal extends the existing host API with new calls (`host_payment_balance`, `host_payment_request`) and extends `ChatMessageContent` with a new `Payment` variant. Existing interfaces remain unchanged.

## Drawbacks

1. **No direct smart-contract transfers** — It is not possible to use coinage to transfer coins directly to a smart contract. Instead, the product is required to first receive the coin keys, unload them into a product-owned address, and then execute the smart-contract call. This may take a noticeable amount of time, though it can be mitigated by allowing the smart contract to react on unload-related events, thus merging the last two steps into a single transaction.
2. **Chat dependency** — The transfer mechanism is tightly coupled to the chat infrastructure. Any chat reliability issues directly impact payment reliability.
3. **Amount hint trust model** — Products must independently verify on-chain state rather than trusting `amount_hint`, adding implementation complexity.

## Alternatives

- Direct on-chain transfers without the chat channel — rejected because coinage's off-chain nature requires a stateful communication channel for key exchange.
- A dedicated payment transport layer separate from chat — rejected to avoid duplicating existing infrastructure.

## Unresolved Questions

1. Should `host_payment_balance` support subscribing to balance changes rather than being a one-shot query?
2. What is the exact user consent UX for balance disclosure — per-session, per-product, or one-time?
3. How should partial payments be handled if the user's spendable balance is insufficient for the requested amount?
4. Should `PaymentRequestErr` include additional error variants (e.g., `InsufficientBalance`, `CoinageUnavailable`)?

## References

- [Coinage Design Document](https://docs.google.com/document/d/124mp6mnMhKFgSjmL6Y1NDzD0v-hRAhmryjqWEJ7yFDk/edit?usp=sharing)
- Existing chat-based host API integration
