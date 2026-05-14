# host-api migration to `@parity/truapi`

This package is being reworked into a thin compatibility facade over
[`@parity/truapi`][1]. The Rust trait surface in `paritytech/truapi`
(`rust/crates/truapi/src/api/*.rs`) is the single source of truth for wire
ids, payload shapes, and dispatch.

The work tracking issue is [`paritytech/truapi#54`][issue].

[1]: https://github.com/paritytech/truapi/tree/main/js/packages/truapi
[issue]: https://github.com/paritytech/truapi/issues/54

## Status

### Done

- `@parity/truapi` added to `package.json` dependencies (currently a `file:`
  link to the local truapi worktree; switch to the published version once
  `@parity/truapi@0.2.0` ships).
- `src/truapi-transport.ts`: directional facade that wraps a legacy
  `Provider` and produces a `@parity/truapi` `TrUApiTransport` instance.

### Not done

- `src/transport.ts` still owns its own request correlation, subscription
  router, frame envelope, and subscription multiplexing. Replace its
  internals with calls into the `@parity/truapi` transport returned from
  `createTruapiTransportFacade()`. Keep the public `Transport` shape from
  `./types.ts` byte-for-byte stable so downstream consumers (`host-papp`,
  `product-react-renderer`, `product-bulletin`, `host-worker-sandbox`,
  `host-api-wrapper`) do not break.
- Active handshake retry / readiness state currently lives in `isReady()`
  inside `transport.ts`. Re-implement on top of the new transport's public
  handshake helpers (the auto-response path inside `@parity/truapi` covers
  passive handshake; active retry stays here as consumer policy).
- Drop subscription multiplexing (the `activeSubscriptions` map and
  `getSubscriptionKey`). `@parity/truapi` exposes 1:1 wire subscriptions,
  any consumer that relies on dedup adds its own multiplexer above this
  package.
- Drop inbound `handleRequest` / `handleSubscription` from the public
  surface, they exist only to support `host-container`, which migrates onto
  `@parity/truapi-host` separately. Update `Transport` in `./types.ts`.
- Repoint the per-codec exports in `src/index.ts` (lines 36 onward) to
  re-export from `@parity/truapi`'s generated `types.ts`. The legacy class
  names (`SigningErr`, `CreateTransactionErr`, `AccountConnectionStatus`,
  …) need either a thin alias layer or a one-shot rename in downstream
  consumers, the generated equivalents use tagged-union shape
  (`{ tag, value }`) rather than `new Err.Variant({...})` calls.
- Delete `src/protocol/v1/*.ts` once every type alias above is repointed.

### Tests

- `src/transport.spec.ts` covers subscription multiplexing today, that test
  will need to move or get retired alongside the multiplexer.
- Add a 56-method byte-equivalence fixture test against a captured
  `@novasamatech/host-api@0.7.7` baseline.
