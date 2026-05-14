# host-container migration to `@parity/truapi-host`

This package is being reworked into a thin compatibility facade over
[`@parity/truapi-host`][1]. The Rust trait surface in `paritytech/truapi`
drives both the wire ids and the typed handler interfaces emitted by the
generator.

The work tracking issue is [`paritytech/truapi#54`][issue].

[1]: https://github.com/paritytech/truapi/tree/main/js/packages/truapi-host
[issue]: https://github.com/paritytech/truapi/issues/54

## Status

### Done

- `@parity/truapi` and `@parity/truapi-host` added to `package.json`
  dependencies (currently `file:` links to the local truapi worktree).
- `src/truapi-container.ts`: directional facade that creates a
  `@parity/truapi-host` server bound to a `Provider`. Default handlers
  reject with "Not Implemented" until each existing `handleXxx` slot is
  lifted across.

### Not done

- `src/createContainer.ts` still owns:
  - 40+ `handleXxx(handler)` slots (the public surface).
  - `handleV1Request` / `handleV1Subscription` wrappers around versioned
    payload envelopes.
  - `makeNotImplementedSlot` / `makePermissionGatedRequestSlot` /
    `makeDevicePermissionGatedRequestSlot`, all of which produce
    method-specific `Unknown { reason: NOT_IMPLEMENTED }` defaults.
  - `handleChainConnection()` (lines ~759–1099): polkadot-api bridge.
    This stays inside this package, only its registration call should
    change to forward to `@parity/truapi-host`'s typed handlers.
- Replace each `handleXxx` slot's update mechanism with a call into
  `@parity/truapi-host`'s typed registration. The slot can remain as the
  public API; under the hood it should mutate the handler reference that
  `createTrUApiServer(...)` is dispatching against.
- Replace `handleV1Request` / `handleV1Subscription` with the typed
  handler signatures from `@parity/truapi-host`'s generated `server.ts`.
  The versioned envelope wrap/unwrap is now performed by the generator,
  not by hand.
- Drop the dependency on `@novasamatech/host-api` once `host-api` itself
  drops its inbound `handleRequest` / `handleSubscription` surface (see
  `packages/host-api/MIGRATION.md`).

### Tests

- `src/chainConnectionManager.spec.ts` is unchanged scope, must continue
  to pass.
- Add an integration test that wires a `@parity/truapi` client and a
  `@parity/truapi-host` server through a `MessageChannel` and exercises
  every wire method via the container's compat shims.
