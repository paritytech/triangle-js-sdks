import {
  CALL_ERROR_FAILURE,
  GenericError,
  PushNotificationError,
  StorageErr,
  StorageReadV2Err,
  callErrorMarker,
  createTransport,
  hostApiProtocol,
  isCallErrorMarker,
} from '@novasamatech/host-api';
import { createLocalStorage, createNotificationManager } from '@novasamatech/host-api-wrapper';
import type { HostApiDebugMessageEvent } from '@novasamatech/host-container';
import { createContainer } from '@novasamatech/host-container';

import { describe, expect, it, vi } from 'vitest';

import { delay } from './__mocks__/helpers.js';
import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

function setup() {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host);
  const sdkTransport = createTransport(providers.sdk);
  const localStorage = createLocalStorage(sdkTransport);
  const notifications = createNotificationManager(sdkTransport);
  return { container, sdkTransport, localStorage, notifications };
}

// The wire error envelope is truapi's `CallError`: a domain error travels in
// `CallError.Domain`, transparently unwrapped back to the domain error here.
// A host-side failure (a thrown handler) travels as `CallError.HostFailure` and
// is folded into the method's own `Unknown` error, so products keep one error
// type.
describe('CallError envelope', () => {
  it('unwraps a domain error back to the domain error', async () => {
    const { container, localStorage } = setup();
    container.localStorage.handleRead((_, { err }) => err(new StorageReadV2Err.Full()));

    await expect(localStorage.readBytes('k')).rejects.toEqual(new StorageErr.Full());
  });

  it('folds a thrown host handler into the method Unknown error', async () => {
    const { container, localStorage } = setup();
    container.localStorage.handleRead(() => {
      throw new Error('handler boom');
    });

    const error = await localStorage.readBytes('k').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageErr.Unknown);
    expect((error as InstanceType<typeof StorageErr.Unknown>).payload.reason).toContain('host failure');
  });

  it('answers Unsupported for a method with no registered handler', async () => {
    // No `container.localStorage.handleRead(...)`, so the host does not
    // implement the method. The container replies `CallError.Unsupported`,
    // which the wrapper folds into the method Unknown error.
    const { localStorage } = setup();

    const error = await localStorage.readBytes('k').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageErr.Unknown);
    expect((error as InstanceType<typeof StorageErr.Unknown>).payload.reason).toContain('unsupported');
  });

  it('answers Unsupported for an unregistered permission-gated method, before the permission gate', async () => {
    // `notifications.sendPushNotification` is device-permission gated and has no registered
    // handler (and no permission handler either). The method being unimplemented
    // takes precedence: the container answers Unsupported rather than asking for
    // a grant and returning a denied domain error.
    const { notifications } = setup();

    const error = await notifications.push({ text: 'hi' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PushNotificationError.Unknown);
    expect((error as InstanceType<typeof PushNotificationError.Unknown>).payload.reason).toContain('unsupported');
  });
  it('withdraws a cancelled call: the handler signal aborts and the host answers Cancelled', async () => {
    const { container, sdkTransport } = setup();
    const outgoing: HostApiDebugMessageEvent[] = [];
    container.onDebugMessage(event => {
      if (event.direction === 'outgoing') outgoing.push(event);
    });

    let handlerSignal: AbortSignal | undefined;
    let releaseHandler: VoidFunction = () => undefined;
    container.localStorage.handleRead((_, { ok, signal }) => {
      handlerSignal = signal;
      return new Promise(resolve => {
        releaseHandler = () => resolve(ok(new Uint8Array([1])));
      });
    });

    const controller = new AbortController();
    const pending = sdkTransport.request('localStorage', 'read', { tag: 'v1', value: 'k' }, controller.signal);
    await vi.waitFor(() => expect(handlerSignal).toBeDefined());

    controller.abort(new Error('product gave up'));
    await expect(pending).rejects.toThrow('product gave up');
    await vi.waitFor(() => expect(handlerSignal?.aborted).toBe(true));

    // Whatever the handler resolves after the cancel is dropped: exactly one
    // response leaves the host, and it is the `Cancelled` transport failure.
    releaseHandler();
    await delay(10);

    const responses = outgoing.filter(
      e => e.payload.trait === 'localStorage' && e.payload.method === 'read' && e.payload.leg === 'response',
    );
    expect(responses).toHaveLength(1);
    const [response] = responses;
    const value = (response?.payload.value as { value: unknown } | undefined)?.value;
    expect(isCallErrorMarker(value)).toBe(true);
    expect(isCallErrorMarker(value) && value[CALL_ERROR_FAILURE]).toEqual({ tag: 'Cancelled' });
  });
});

// Wire layering of truapi's legs: a response is
// `Result<Versioned<Ok>, CallError<Versioned<Err>>>` — the version tag sits
// inside each `Result` arm, and a transport failure carries no version at all.
describe('CallError wire layering', () => {
  const read = hostApiProtocol.localStorage.methods.read;
  const themeSubscribe = hostApiProtocol.theme.methods.subscribe;

  // Result: Ok = 0, Err = 1. CallError: Domain = 0, Denied = 1, Unsupported = 2,
  // MalformedFrame = 3, HostFailure = 4, Cancelled = 5.
  it('encodes an Ok answer as Ok(Versioned(value))', () => {
    const bytes = read.response.enc({ tag: 'v2', value: { success: true, value: undefined } });
    // Ok, v2, Option::None
    expect(Array.from(bytes)).toEqual([0, 1, 0]);
    expect(read.response.dec(bytes)).toEqual({ tag: 'v2', value: { success: true, value: undefined } });
  });

  it('encodes a domain error as Err(Domain(Versioned(error)))', () => {
    const bytes = read.response.enc({
      tag: 'v2',
      value: { success: false, value: new StorageReadV2Err.AccessNotGranted() },
    });
    // Err, Domain, v2, AccessNotGranted
    expect(Array.from(bytes)).toEqual([1, 0, 1, 1]);

    const decoded = read.response.dec(bytes);
    expect(decoded.tag).toBe('v2');
    expect(decoded.value).toEqual({ success: false, value: new StorageReadV2Err.AccessNotGranted() });
  });

  it.each([
    [{ tag: 'Denied' } as const, [1, 1]],
    [{ tag: 'Unsupported' } as const, [1, 2]],
    [{ tag: 'Cancelled' } as const, [1, 5]],
  ])('encodes the unversioned transport failure %o as Err(CallError)', (failure, expected) => {
    const bytes = read.response.enc({ tag: 'v2', value: callErrorMarker(failure) });
    expect(Array.from(bytes)).toEqual(expected);

    // It decodes under the first version; the transport re-tags it with the
    // version the request was made in.
    const decoded = read.response.dec(bytes);
    expect(decoded.tag).toBe('v1');
    expect(isCallErrorMarker(decoded.value) && decoded.value[CALL_ERROR_FAILURE]).toEqual(failure);
  });

  it('encodes a transport failure carrying a reason', () => {
    const failure = { tag: 'HostFailure', value: { reason: 'x' } } as const;
    const bytes = read.response.enc({ tag: 'v1', value: callErrorMarker(failure) });
    // Err, HostFailure, str("x")
    expect(Array.from(bytes)).toEqual([1, 4, 4, 120]);
    const decoded = read.response.dec(bytes);
    expect(isCallErrorMarker(decoded.value) && decoded.value[CALL_ERROR_FAILURE]).toEqual(failure);
  });

  it('encodes a subscription interrupt as Result<(), CallError<Versioned<Err>>>', () => {
    // Clean completion: Ok(())
    expect(Array.from(themeSubscribe.interrupt.enc({ tag: 'v1', value: undefined }))).toEqual([0]);
    expect(themeSubscribe.interrupt.dec(new Uint8Array([0]))).toEqual({ tag: 'v1', value: undefined });

    // Domain reason: Err(Domain(v1(GenericError { reason })))
    const reason = new GenericError({ reason: 'x' });
    const domainBytes = themeSubscribe.interrupt.enc({ tag: 'v1', value: reason });
    expect(Array.from(domainBytes)).toEqual([1, 0, 0, 4, 120]);
    expect(themeSubscribe.interrupt.dec(domainBytes)).toEqual({ tag: 'v1', value: reason });

    // Transport failure: Err(Unsupported)
    const failureBytes = themeSubscribe.interrupt.enc({ tag: 'v1', value: callErrorMarker({ tag: 'Unsupported' }) });
    expect(Array.from(failureBytes)).toEqual([1, 2]);
    const decoded = themeSubscribe.interrupt.dec(failureBytes);
    expect(isCallErrorMarker(decoded.value) && decoded.value[CALL_ERROR_FAILURE]).toEqual({ tag: 'Unsupported' });
  });
});
