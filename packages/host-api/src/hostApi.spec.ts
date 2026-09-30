import { enumValue, resultOk } from '@novasamatech/scale';
import { createNanoEvents } from 'nanoevents';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { createHostApi } from './hostApi.js';
import { createDefaultLogger } from './logger.js';
import { callErrorMarker } from './protocol/callError.js';
import { hostApiProtocol } from './protocol/impl.js';
import { StorageErr, StorageReadV2Err } from './protocol/v1/localStorage.js';
import type { Provider } from './provider.js';
import { createTransport } from './transport.js';

function createPair() {
  type Events = 'toHost' | 'toSdk';
  const bus = createNanoEvents<Record<Events, (v: Uint8Array) => void>>();

  const createProvider = (listenTo: Events, postTo: Events): Provider => ({
    logger: createDefaultLogger(),
    isCorrectEnvironment: () => true,
    dispose: () => delete bus.events[listenTo],
    subscribe: callback => bus.on(listenTo, callback),
    postMessage: message => bus.emit(postTo, message),
  });

  const host = createTransport(createProvider('toHost', 'toSdk'));
  const sdk = createTransport(createProvider('toSdk', 'toHost'));
  return { host, sdk, hostApi: createHostApi(sdk) };
}

describe('createHostApi', () => {
  it('nests every product-facing method under its trait', () => {
    const { hostApi } = createPair();

    for (const [trait, { methods }] of Object.entries(hostApiProtocol)) {
      for (const [method, definition] of Object.entries(methods)) {
        const group = hostApi[trait as keyof typeof hostApi] as Record<string, unknown>;
        if (definition.kind === 'request' && definition.internal) {
          expect(group[method], `${trait}.${method}`).toBeUndefined();
        } else {
          expect(group[method], `${trait}.${method}`).toBeTypeOf('function');
        }
      }
    }
  });

  it('keeps host-internal methods off the product API', () => {
    const { hostApi } = createPair();
    expectTypeOf(hostApi.permissions).not.toHaveProperty('authorizeRemotePermission');
    expectTypeOf(hostApi.permissions).toHaveProperty('requestRemotePermission');
  });

  it('calls a request method and unwraps its result', async () => {
    const { host, hostApi } = createPair();
    host.handleRequest('localStorage', 'read', async ({ tag }) => enumValue(tag, resultOk(new Uint8Array([1]))));

    const result = await hostApi.localStorage.read(enumValue('v1', 'key'));

    expect(result._unsafeUnwrap()).toEqual({ tag: 'v1', value: new Uint8Array([1]) });
  });

  it('folds a transport failure into the version-specific domain error', async () => {
    const { host, hostApi } = createPair();
    host.handleRequest('localStorage', 'read', async ({ tag }) => ({
      tag,
      value: callErrorMarker({ tag: 'Unsupported' }),
    }));

    const v1 = await hostApi.localStorage.read(enumValue('v1', 'key'));
    const v2 = await hostApi.localStorage.read(enumValue('v2', { product: undefined, key: 'key' }));

    expect(v1._unsafeUnwrapErr().value).toBeInstanceOf(StorageErr.Unknown);
    expect(v2._unsafeUnwrapErr()).toMatchObject({ tag: 'v2' });
    expect(v2._unsafeUnwrapErr().value).toBeInstanceOf(StorageReadV2Err.Unknown);
  });

  it('serves a host-initiated subscription instead of subscribing to it', () => {
    const { host, hostApi } = createPair();
    const render = vi.fn((_params, send: (v: never) => void) => {
      send(enumValue('v1', enumValue('String', 'Hi')) as never);
      return vi.fn();
    });
    hostApi.renderer.render(render);

    const received = vi.fn();
    host.subscribe(
      'renderer',
      'render',
      enumValue('v1', {
        context: enumValue('PocketCard', { cardId: 'card' }),
        payload: new Uint8Array(),
      }),
      received,
    );

    expect(render).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith({ tag: 'v1', value: { tag: 'String', value: 'Hi' } });
  });
});
