import { Enum } from '@novasamatech/scale';
import type { Codec, CodecType, ResultPayload } from 'scale-ts';
import { Result as ScaleResult, Struct, _void, enhanceCodec, str } from 'scale-ts';

// Transport-level error envelope, mirroring truapi's derived `CallError<D>`.
// `Domain` carries a business (domain) error; the other four are transport or
// host failures that are not part of any method's business error type.
//
// This is a transport primitive: business code never constructs or inspects it.
// `callResult` wraps a plain domain error into it on the wire and unwraps it
// back to the domain error on decode, so `_response` codecs stay byte-identical
// to truapi while the values handlers and products see remain the domain shape.

/** The transport-level failure variants (everything except `Domain`). */
export type CallErrorTransportFailure =
  | { tag: 'Denied' }
  | { tag: 'Unsupported' }
  | { tag: 'MalformedFrame'; value: { reason: string } }
  | { tag: 'HostFailure'; value: { reason: string } };

/** Wraps a domain error codec into a `V1`-versioned enum, as truapi does. */
const versioned = <D>(domain: Codec<D>) => Enum({ v1: domain }, [0]);

/** SCALE codec for `CallError<D>`, discriminants pinned to the truapi order. */
export const CallError = <D>(domain: Codec<D>) =>
  Enum(
    {
      Domain: domain,
      Denied: _void,
      Unsupported: _void,
      MalformedFrame: Struct({ reason: str }),
      HostFailure: Struct({ reason: str }),
    },
    [0, 1, 2, 3, 4],
  );

/** A decoded transport failure carries this brand so the transport can spot it. */
export const CALL_ERROR_FAILURE = Symbol('callErrorFailure');

/** Business (present) shape of a response: a plain scale-ts `Result`. */
type Business<OK, ERR> = ResultPayload<OK, ERR>;

/** True when a decoded response is a transport-level `CallError`, not a domain answer. */
export const isCallErrorFailure = <OK, ERR>(
  value: CallResultValue<OK, ERR>,
): value is { [CALL_ERROR_FAILURE]: CallErrorTransportFailure } => CALL_ERROR_FAILURE in value;

export type CallResultValue<OK, ERR> = Business<OK, ERR> | { [CALL_ERROR_FAILURE]: CallErrorTransportFailure };

export const CallResult = <OK, ERR>(ok: Codec<OK>, domainErr: Codec<ERR>): Codec<CallResultValue<OK, ERR>> => {
  const wire = ScaleResult(ok, CallError(versioned(domainErr)));

  return enhanceCodec<CodecType<typeof wire>, CallResultValue<OK, ERR>>(
    wire,
    value => {
      if (CALL_ERROR_FAILURE in value) {
        // Re-encoding a decoded transport failure (rare): pass it straight back.
        return { success: false, value: value[CALL_ERROR_FAILURE] } as CodecType<typeof wire>;
      }
      if (value.success) return { success: true, value: value.value } as CodecType<typeof wire>;
      return { success: false, value: { tag: 'Domain', value: { tag: 'v1', value: value.value } } } as CodecType<
        typeof wire
      >;
    },
    decoded => {
      if (decoded.success) return { success: true, value: decoded.value };
      const callError = decoded.value;
      if (callError.tag === 'Domain') {
        return { success: false, value: callError.value.value };
      }
      return { [CALL_ERROR_FAILURE]: callError as CallErrorTransportFailure };
    },
  );
};

/** A decoded subscription interrupt: the domain reason, or a transport failure. */
export type CallInterruptValue<ERR> = ERR | { [CALL_ERROR_FAILURE]: CallErrorTransportFailure };

/**
 * Interrupt codec counterpart to `Result`. A subscription's interrupt reason is
 * `CallError(V1(err))` on the wire (byte-identical to truapi); its value form is
 * the plain domain reason for the `Domain` case, and a `CALL_ERROR_FAILURE`
 * marker for a transport-level interrupt. The transport assembly applies this to
 * typed interrupts, so interrupt codec definitions stay the plain domain error.
 */
export const interruptError = <ERR>(domainErr: Codec<ERR>): Codec<CallInterruptValue<ERR>> => {
  const wire = CallError(versioned(domainErr));

  return enhanceCodec<CodecType<typeof wire>, CallInterruptValue<ERR>>(
    wire,
    value => {
      if (typeof value === 'object' && value !== null && CALL_ERROR_FAILURE in value) {
        const failure = value[CALL_ERROR_FAILURE];
        return { tag: failure.tag, value: 'value' in failure ? failure.value : undefined } as CodecType<typeof wire>;
      }
      return { tag: 'Domain', value: { tag: 'v1', value } } as CodecType<typeof wire>;
    },
    decoded => {
      if (decoded.tag === 'Domain') return decoded.value.value;
      return { [CALL_ERROR_FAILURE]: decoded as CallErrorTransportFailure };
    },
  );
};
