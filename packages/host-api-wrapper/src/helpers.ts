import type { CallErrorMarker, CallErrorTransportFailure, CodecType, Subscription } from '@novasamatech/host-api';
import { CALL_ERROR_FAILURE, GenericError, isCallErrorMarker } from '@novasamatech/host-api';
import type { ResultAsync } from 'neverthrow';
import { err, ok } from 'neverthrow';

/** Interrupt reason of every subscription whose spec error is the plain `GenericError`. */
export type GenericInterrupt = CodecType<typeof GenericError>;

export function unwrapVersionedResult<OK, KO, V extends string>(
  version: V,
  result: ResultAsync<{ tag: V; value: OK }, { tag: V; value: KO }>,
) {
  return result
    .orElse(payload => {
      if (payload.tag !== version) {
        return err(new Error(`Unsupported result version ${payload.tag}`));
      }
      return err(payload.value);
    })
    .andThen(payload => {
      if (payload.tag !== version) {
        return err(new Error(`Unsupported result version ${payload.tag}`));
      }

      return ok(payload.value);
    });
}

export function resultToPromise<T>(result: ResultAsync<T, unknown>) {
  return new Promise<T>((resolve, reject) => result.match(resolve, reject));
}

/** Human-readable reason for a transport-level `CallError`. */
export function describeCallErrorFailure(failure: CallErrorTransportFailure): string {
  switch (failure.tag) {
    case 'Denied':
      return 'call denied by host';
    case 'Unsupported':
      return 'method unsupported by host';
    case 'MalformedFrame':
      return `malformed frame: ${failure.value.reason}`;
    case 'HostFailure':
      return `host failure: ${failure.value.reason}`;
    case 'Cancelled':
      return 'call cancelled';
  }
}

/** Folds a transport failure into a `GenericError`, for subscriptions whose spec error is `GenericError`. */
export const genericInterrupt = (reason: string): GenericInterrupt => new GenericError({ reason });

/**
 * Strips the version envelope from a subscription's interrupt payload.
 *
 * `onInterrupt` then receives the method's domain error, or `undefined` when the
 * host ended the stream cleanly. A transport-level failure (`CallError` other
 * than `Domain`) is folded into the domain error through `fallback`, so callers
 * handle a single error type — the same way request methods do.
 */
export function unwrapVersionedSubscription<Interrupt>(
  subscriber: Subscription<{ tag: string; value: Interrupt | CallErrorMarker | undefined }>,
  fallback: (reason: string) => Interrupt,
): Subscription<Interrupt | undefined> {
  return {
    unsubscribe: subscriber.unsubscribe,
    onInterrupt: cb =>
      subscriber.onInterrupt(({ value }) =>
        cb(isCallErrorMarker(value) ? fallback(describeCallErrorFailure(value[CALL_ERROR_FAILURE])) : value),
      ),
  };
}
