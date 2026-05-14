/**
 * Facade host container built on `@parity/truapi-host`.
 *
 * Replaces the bespoke per-method dispatch, "Not Implemented" fallbacks, and
 * `handleV1Request` / `handleV1Subscription` wrappers in `createContainer.ts`
 * with the typed handler registration produced by `@parity/truapi-host`'s
 * generator.
 *
 * The new public surface is structured-by-service, mirroring the Rust trait
 * surface in `truapi`. Hosts that consume `createContainer()` today (with
 * `handleXxx` slots) keep working through compat shims in
 * `createContainer.ts`, which forward to `createTruapiContainer()` under the
 * hood.
 *
 * Status: directional. The generated `TrUApiHostHandlers` interface forces
 * the caller to supply every service handler (handlers must not throw, per
 * the `@parity/truapi-host` contract; every outcome including unsupported
 * versions and missing implementations is expressed as a typed return).
 * Lifting each existing `handleXxx` slot's behaviour into the matching typed
 * handler is the bulk of the remaining migration.
 */

import type { Provider as TruapiProvider } from '@parity/truapi';
import type { TrUApiHostHandlers, TrUApiHostServer } from '@parity/truapi-host';
import { createTrUApiServer } from '@parity/truapi-host';

/**
 * Attach a host server built on `@parity/truapi-host` to a `Provider`.
 *
 * The caller supplies the full `TrUApiHostHandlers` shape. The TypeScript
 * compiler enforces completeness, anything missing is flagged at the call
 * site rather than papered over with a stub that would throw at runtime.
 */
export function createTruapiContainer(provider: TruapiProvider, handlers: TrUApiHostHandlers): TrUApiHostServer {
  return createTrUApiServer(provider, handlers);
}
