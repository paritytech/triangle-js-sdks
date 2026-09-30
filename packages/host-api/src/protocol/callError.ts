import { Enum } from '@novasamatech/scale';
import type { Codec, CodecType, ResultPayload } from 'scale-ts';
import { Result as ScaleResult, Struct, _void, enhanceCodec, str } from 'scale-ts';

// Transport-level error envelope, mirroring truapi's derived `CallError<D>`.
// `Domain` carries a business (domain) error; the other variants are transport
// or host failures that are not part of any method's business error type.
//
// This is a transport primitive: business code never constructs or inspects it.
// `callResponse` / `callInterrupt` fold it into the value shapes handlers and
// products see (`{ tag, value }` with the version tag on the outside), while
// the wire keeps truapi's layering: the version tag sits *inside* the `Result`,
// on each arm's own versioned wrapper.

/** The transport-level failure variants (everything except `Domain`). */
export type CallErrorTransportFailure =
  | { tag: 'Denied' }
  | { tag: 'Unsupported' }
  | { tag: 'MalformedFrame'; value: { reason: string } }
  | { tag: 'HostFailure'; value: { reason: string } }
  | { tag: 'Cancelled' };

/** SCALE codec for `CallError<D>`, discriminants pinned to the truapi order. */
export const CallError = <D>(domain: Codec<D>) =>
  Enum(
    {
      Domain: domain,
      Denied: _void,
      Unsupported: _void,
      MalformedFrame: Struct({ reason: str }),
      HostFailure: Struct({ reason: str }),
      // Appended last in truapi, so the variants above keep their indices.
      Cancelled: _void,
    },
    [0, 1, 2, 3, 4, 5],
  );

/** A decoded transport failure carries this brand so the transport can spot it. */
export const CALL_ERROR_FAILURE = Symbol('callErrorFailure');

export type CallErrorMarker = { [CALL_ERROR_FAILURE]: CallErrorTransportFailure };

export const callErrorMarker = (failure: CallErrorTransportFailure): CallErrorMarker => ({
  [CALL_ERROR_FAILURE]: failure,
});

export const isCallErrorMarker = (value: unknown): value is CallErrorMarker =>
  typeof value === 'object' && value !== null && CALL_ERROR_FAILURE in value;

/** True when a decoded response is a transport-level `CallError`, not a domain answer. */
export const isCallErrorFailure = <OK, ERR>(value: CallResultValue<OK, ERR>): value is CallErrorMarker =>
  isCallErrorMarker(value);

export type CallResultValue<OK, ERR> = ResultPayload<OK, ERR> | CallErrorMarker;

type Versioned = Record<string, Codec<any>>;
type VersionTag<V extends Versioned> = keyof V & string;

/**
 * Value shape of a response leg: the version tag on the outside, the business
 * `Result` (or a transport failure) inside it.
 */
export type CallResponseValue<OkV extends Versioned, ErrV extends Versioned> = {
  [K in VersionTag<OkV> & VersionTag<ErrV>]: {
    tag: K;
    value: CallResultValue<CodecType<OkV[K]>, CodecType<ErrV[K]>>;
  };
}[VersionTag<OkV> & VersionTag<ErrV>];

/**
 * Value shape of a subscription's interrupt leg: `undefined` for a clean,
 * error-free completion, the domain reason, or a transport failure.
 */
export type CallInterruptValue<ErrV extends Versioned> = {
  [K in VersionTag<ErrV>]: {
    tag: K;
    value: CodecType<ErrV[K]> | CallErrorMarker | undefined;
  };
}[VersionTag<ErrV>];

type WireVersioned = { tag: string; value: unknown };
type WireCallError = { tag: 'Domain'; value: WireVersioned } | CallErrorTransportFailure;

const firstTag = (versions: Versioned) => {
  const [tag] = Object.keys(versions);
  if (tag === undefined) throw new Error('A versioned leg needs at least one version');
  return tag;
};

const toWireFailure = (marker: CallErrorMarker): WireCallError => marker[CALL_ERROR_FAILURE];

/**
 * Response leg: `Result<{Method}Response, CallError<{Method}Error>>`, both arms
 * already-versioned wrappers. A transport failure carries no version on the
 * wire, so it decodes under the first version; the transport re-tags it with
 * the version the request was made in.
 */
export const callResponse = <const OkV extends Versioned, const ErrV extends Versioned>(
  okVersions: OkV,
  errVersions: ErrV,
): Codec<CallResponseValue<OkV, ErrV>> => {
  const wire = ScaleResult(Enum(okVersions), CallError(Enum(errVersions)));
  const fallbackTag = firstTag(okVersions);

  return enhanceCodec<CodecType<typeof wire>, CallResponseValue<OkV, ErrV>>(
    wire,
    ({ tag, value }) => {
      if (isCallErrorMarker(value)) {
        return { success: false, value: toWireFailure(value) } as CodecType<typeof wire>;
      }
      if (value.success) {
        return { success: true, value: { tag, value: value.value } } as CodecType<typeof wire>;
      }
      return { success: false, value: { tag: 'Domain', value: { tag, value: value.value } } } as CodecType<typeof wire>;
    },
    decoded => {
      if (decoded.success) {
        const ok = decoded.value as WireVersioned;
        return { tag: ok.tag, value: { success: true, value: ok.value } } as CallResponseValue<OkV, ErrV>;
      }
      const callError = decoded.value as WireCallError;
      if (callError.tag === 'Domain') {
        return {
          tag: callError.value.tag,
          value: { success: false, value: callError.value.value },
        } as CallResponseValue<OkV, ErrV>;
      }
      return { tag: fallbackTag, value: callErrorMarker(callError) } as CallResponseValue<OkV, ErrV>;
    },
  );
};

/**
 * Interrupt leg: `Result<(), CallError<{Method}Error>>`. `Ok(())` is a clean
 * completion, `Err(Domain(..))` the method's own interrupt reason, and any
 * other `Err` a transport failure.
 */
export const callInterrupt = <const ErrV extends Versioned>(errVersions: ErrV): Codec<CallInterruptValue<ErrV>> => {
  const wire = ScaleResult(_void, CallError(Enum(errVersions)));
  const fallbackTag = firstTag(errVersions);

  return enhanceCodec<CodecType<typeof wire>, CallInterruptValue<ErrV>>(
    wire,
    ({ tag, value }) => {
      if (value === undefined) {
        return { success: true, value: undefined } as CodecType<typeof wire>;
      }
      if (isCallErrorMarker(value)) {
        return { success: false, value: toWireFailure(value) } as CodecType<typeof wire>;
      }
      return { success: false, value: { tag: 'Domain', value: { tag, value } } } as CodecType<typeof wire>;
    },
    decoded => {
      if (decoded.success) {
        return { tag: fallbackTag, value: undefined } as CallInterruptValue<ErrV>;
      }
      const callError = decoded.value as WireCallError;
      if (callError.tag === 'Domain') {
        return { tag: callError.value.tag, value: callError.value.value } as CallInterruptValue<ErrV>;
      }
      return { tag: fallbackTag, value: callErrorMarker(callError) } as CallInterruptValue<ErrV>;
    },
  );
};
