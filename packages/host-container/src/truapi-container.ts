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
 * Status: directional. The handlers map below names the same wire methods
 * `createContainer.ts` registers today, but each handler is a stub that
 * throws "Not Implemented". The migration plan is to lift each existing
 * `handleXxx` slot's behaviour into the matching typed handler, then delete
 * `createContainer.ts`'s registration scaffolding.
 */

import type { Provider as TruapiProvider } from '@parity/truapi';
import type { TrUApiHostHandlers, TrUApiHostServer } from '@parity/truapi-host';
import { createTrUApiServer } from '@parity/truapi-host';

/**
 * Build a stub handler that rejects with a "Not Implemented" error. The
 * legacy container produces method-specific error variants for the wire,
 * the migration TODO is to replace these stubs with handlers that produce
 * the corresponding typed responses.
 */
function unimplemented(method: string) {
  return async () => {
    throw new Error(`@parity/truapi-host handler not yet wired: ${method}`);
  };
}

/**
 * Stand-in until per-method handlers are lifted across from
 * `createContainer.ts`. Replace each entry as the migration progresses.
 */
function defaultHandlers(): TrUApiHostHandlers {
  const proxy = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === 'then') return undefined;
        return unimplemented(String(prop));
      },
    },
  );
  return {
    account: proxy as TrUApiHostHandlers['account'],
    chain: proxy as TrUApiHostHandlers['chain'],
    chat: proxy as TrUApiHostHandlers['chat'],
    entropy: proxy as TrUApiHostHandlers['entropy'],
    jsonRpc: proxy as TrUApiHostHandlers['jsonRpc'],
    localStorage: proxy as TrUApiHostHandlers['localStorage'],
    payment: proxy as TrUApiHostHandlers['payment'],
    permissions: proxy as TrUApiHostHandlers['permissions'],
    preimage: proxy as TrUApiHostHandlers['preimage'],
    resourceAllocation: proxy as TrUApiHostHandlers['resourceAllocation'],
    signing: proxy as TrUApiHostHandlers['signing'],
    statementStore: proxy as TrUApiHostHandlers['statementStore'],
    system: proxy as TrUApiHostHandlers['system'],
    theme: proxy as TrUApiHostHandlers['theme'],
  };
}

/**
 * Attach a host server built on `@parity/truapi-host` to a `Provider`.
 * Returns the underlying server handle, callers dispose it when the host
 * tears down.
 */
export function createTruapiContainer(
  provider: TruapiProvider,
  handlers: Partial<TrUApiHostHandlers> = {},
): TrUApiHostServer {
  const merged = { ...defaultHandlers(), ...handlers } as TrUApiHostHandlers;
  return createTrUApiServer(provider, merged);
}
