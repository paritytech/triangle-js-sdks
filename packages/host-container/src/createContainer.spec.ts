import type { Provider } from '@novasamatech/host-api';
import {
  CALL_ERROR_FAILURE,
  GenericError,
  PaymentBalanceErr,
  PreimageSubmitErr,
  StorageErr,
  StorageReadV2Err,
  createDefaultLogger,
  createTransport,
  enumValue,
  isCallErrorMarker,
  resultOk,
} from '@novasamatech/host-api';
import { createNanoEvents } from 'nanoevents';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { createContainer } from './createContainer.js';
import type { Container, HostApiDebugMessageEvent } from './types.js';

function createProviders() {
  type Events = 'toHost' | 'toSdk';
  const bus = createNanoEvents<Record<Events, (v: Uint8Array) => void>>();

  function createProvider(listenTo: Events, postTo: Events): Provider {
    return {
      logger: createDefaultLogger(),
      isCorrectEnvironment: () => true,
      dispose: () => delete bus.events[listenTo],
      subscribe: callback => bus.on(listenTo, callback),
      postMessage: message => bus.emit(postTo, message),
    };
  }

  return {
    host: createProvider('toHost', 'toSdk'),
    sdk: createProvider('toSdk', 'toHost'),
  };
}

function setup() {
  const providers = createProviders();
  const container = createContainer(providers.host, { productId: 'product.dot' });
  const product = createTransport(providers.sdk);
  return { container, product };
}

const failureOf = (value: unknown) => (isCallErrorMarker(value) ? value[CALL_ERROR_FAILURE] : undefined);

function nextInterrupt(subscription: { onInterrupt(callback: (payload: unknown) => void): VoidFunction }) {
  return new Promise<unknown>(resolve => subscription.onInterrupt(resolve));
}

describe('createContainer', () => {
  describe('shape', () => {
    it('nests slots by trait with spec method names', () => {
      expectTypeOf<keyof Container['system']>().toEqualTypeOf<
        'handleFeatureSupported' | 'handleNavigateTo' | 'handleInfo' | 'handleGetProductContext'
      >();
      expectTypeOf<keyof Container['chain']>().toEqualTypeOf<'handleGetChainInfo'>();
      expectTypeOf<keyof Container['renderer']>().toEqualTypeOf<'render' | 'handleActionSubscribe'>();
      expectTypeOf<keyof Container['permissions']>().toEqualTypeOf<
        | 'handleRequestDevicePermission'
        | 'handleRequestRemotePermission'
        | 'handleAuthorizeRemotePermission'
        | 'handleAuthorizeDevicePermission'
      >();
      expectTypeOf<Parameters<Parameters<Container['localStorage']['handleRead']>[0]>[0]>().toEqualTypeOf<{
        product: string | undefined;
        key: string;
      }>();
    });
  });

  describe('request slots', () => {
    it('answers Unsupported while no handler is registered', async () => {
      const { product } = setup();

      const response = await product.request('account', 'getUserId', enumValue('v1', undefined));

      expect(failureOf(response.value)).toEqual({ tag: 'Unsupported' });
    });

    it('serves a registered handler and restores Unsupported on cleanup', async () => {
      const { container, product } = setup();

      const cleanup = container.system.handleNavigateTo((url, { ok }) => {
        expect(url).toBe('https://example.com');
        return ok(undefined);
      });

      await expect(product.request('system', 'navigateTo', enumValue('v1', 'https://example.com'))).resolves.toEqual(
        enumValue('v1', resultOk(undefined)),
      );

      cleanup();

      const response = await product.request('system', 'navigateTo', enumValue('v1', 'https://example.com'));
      expect(failureOf(response.value)).toEqual({ tag: 'Unsupported' });
    });

    it('aborts the handler signal when the product withdraws the call', async () => {
      const { container, product } = setup();
      const started = vi.fn();
      const aborted = vi.fn();

      container.entropy.handleDerive((_key, { signal }) => {
        started();
        signal.addEventListener('abort', aborted);
        return new Promise(() => {
          /* never settles */
        });
      });

      await product.isReady();
      const controller = new AbortController();
      const request = product.request('entropy', 'derive', enumValue('v1', new Uint8Array([1])), controller.signal);
      await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
      expect(aborted).not.toHaveBeenCalled();
      controller.abort();

      await expect(request).rejects.toBeDefined();
      await vi.waitFor(() => expect(aborted).toHaveBeenCalledOnce());
    });

    it('serves the host-internal authorize methods', async () => {
      const { container, product } = setup();

      container.permissions.handleAuthorizeRemotePermission((permission, { ok }) => ok(permission.tag === 'WebRtc'));

      await expect(
        product.request('permissions', 'authorizeRemotePermission', enumValue('v1', enumValue('WebRtc', undefined))),
      ).resolves.toEqual(enumValue('v1', resultOk(true)));
    });
  });

  describe('permission-gated slots', () => {
    const preimage = new Uint8Array([1, 2, 3]);

    it('answers Unsupported without asking for the grant while no handler is registered', async () => {
      const { container, product } = setup();
      const asked = vi.fn();
      container.permissions.handleRequestRemotePermission((permission, { ok }) => {
        asked(permission);
        return ok(true);
      });

      const response = await product.request('preimage', 'submit', enumValue('v1', preimage));

      expect(failureOf(response.value)).toEqual({ tag: 'Unsupported' });
      expect(asked).not.toHaveBeenCalled();
    });

    it('answers the domain error when the grant is denied', async () => {
      const { container, product } = setup();
      const submit = vi.fn();
      container.preimage.handleSubmit((value, { ok }) => {
        submit(value);
        return ok('0x00');
      });
      container.permissions.handleRequestRemotePermission((_permission, { ok }) => ok(false));

      const response = await product.request('preimage', 'submit', enumValue('v1', preimage));

      expect(response.value).toMatchObject({ success: false });
      expect((response.value as { value: unknown }).value).toBeInstanceOf(PreimageSubmitErr.Unknown);
      expect(submit).not.toHaveBeenCalled();
    });

    it('runs the handler once the grant is given', async () => {
      const { container, product } = setup();
      const asked = vi.fn();
      container.preimage.handleSubmit((_value, { ok }) => ok('0x01'));
      container.permissions.handleRequestRemotePermission((permission, { ok }) => {
        asked(permission);
        return ok(true);
      });

      await expect(product.request('preimage', 'submit', enumValue('v1', preimage))).resolves.toEqual(
        enumValue('v1', resultOk('0x01')),
      );
      expect(asked).toHaveBeenCalledWith(enumValue('PreimageSubmit', undefined));
    });
  });

  describe('localStorage.read', () => {
    it('upgrades a v1 request to the caller’s own storage', async () => {
      const { container, product } = setup();
      const read = vi.fn();
      container.localStorage.handleRead((request, { ok }) => {
        read(request);
        return ok(new Uint8Array([7]));
      });

      await expect(product.request('localStorage', 'read', enumValue('v1', 'key'))).resolves.toEqual(
        enumValue('v1', resultOk(new Uint8Array([7]))),
      );
      expect(read).toHaveBeenCalledWith({ product: undefined, key: 'key' });
    });

    it('passes a v2 AccessNotGranted through and downgrades it for a v1 caller', async () => {
      const { container, product } = setup();
      container.localStorage.handleRead((_request, { err }) => err(new StorageReadV2Err.AccessNotGranted()));

      const v2 = await product.request('localStorage', 'read', enumValue('v2', { product: 'other.dot', key: 'key' }));
      expect(v2.tag).toBe('v2');
      expect((v2.value as { value: unknown }).value).toBeInstanceOf(StorageReadV2Err.AccessNotGranted);

      const v1 = await product.request('localStorage', 'read', enumValue('v1', 'key'));
      expect(v1.tag).toBe('v1');
      const error = (v1.value as { value: unknown }).value;
      expect(error).toBeInstanceOf(StorageErr.Unknown);
      expect((error as InstanceType<typeof StorageErr.Unknown>).payload).toEqual({
        reason: 'the owning product grants no read access to its storage',
      });
    });

    it('keeps Full as Full for a v1 caller', async () => {
      const { container, product } = setup();
      container.localStorage.handleRead((_request, { err }) => err(new StorageReadV2Err.Full()));

      const v1 = await product.request('localStorage', 'read', enumValue('v1', 'key'));
      expect((v1.value as { value: unknown }).value).toBeInstanceOf(StorageErr.Full);
    });
  });

  describe('subscription slots', () => {
    it('interrupts with Unsupported while no handler is registered', async () => {
      const { product } = setup();
      await product.isReady();

      const interrupt = await nextInterrupt(
        product.subscribe('theme', 'subscribe', enumValue('v1', undefined), vi.fn()),
      );

      expect(failureOf((interrupt as { value: unknown }).value)).toEqual({ tag: 'Unsupported' });
    });

    it('keeps a domain default interrupt where the slot has one', async () => {
      const { product } = setup();
      await product.isReady();

      const interrupt = await nextInterrupt(
        product.subscribe('payment', 'balanceSubscribe', enumValue('v1', { purse: undefined }), vi.fn()),
      );

      expect((interrupt as { value: unknown }).value).toBeInstanceOf(PaymentBalanceErr.Unknown);
    });

    it('unwraps the version for send and interrupt', async () => {
      const { container, product } = setup();
      container.pocket.handleListSubscribe((_params, send, interrupt) => {
        send({ cards: [{ cardId: 'a', privileged: false }] });
        interrupt(new GenericError({ reason: 'done' }));
        return () => {
          /* nothing to clean up */
        };
      });
      await product.isReady();

      const received = vi.fn();
      const interrupt = await nextInterrupt(
        product.subscribe('pocket', 'listSubscribe', enumValue('v1', undefined), received),
      );

      expect(received).toHaveBeenCalledWith(enumValue('v1', { cards: [{ cardId: 'a', privileged: false }] }));
      expect((interrupt as { value: unknown }).value).toBeInstanceOf(GenericError);
    });
  });

  describe('chain', () => {
    it('answers Unsupported before handleChainConnection is called', async () => {
      const { product } = setup();

      const response = await product.request('chain', 'getSpecChainName', enumValue('v1', '0x00'));

      expect(failureOf(response.value)).toEqual({ tag: 'Unsupported' });
    });
  });

  describe('renderer.render', () => {
    it('subscribes to the product and unwraps the rendered nodes', async () => {
      const { container, product } = setup();
      const started = vi.fn();
      product.handleSubscription('renderer', 'render', (params, send, interrupt) => {
        started(params);
        send(enumValue('v1', { tag: 'String', value: 'hello' }));
        interrupt(enumValue('v1', undefined));
        return () => {
          /* nothing to clean up */
        };
      });
      await container.isReady();

      const context = enumValue('ChatMessage', { roomId: 'room', messageId: 'message', messageType: 'card' });
      const payload = new Uint8Array([1]);
      const nodes = vi.fn();
      const interrupt = await nextInterrupt(container.renderer.render({ context, payload }, nodes));

      expect(started).toHaveBeenCalledWith(enumValue('v1', { context, payload }));
      expect(nodes).toHaveBeenCalledWith({ tag: 'String', value: 'hello' });
      expect(interrupt).toBeUndefined();
    });
  });

  describe('onDebugMessage', () => {
    it('reports decoded messages tagged with the productId', async () => {
      const { container, product } = setup();
      const events: HostApiDebugMessageEvent[] = [];
      container.onDebugMessage(event => events.push(event));

      await product.request('account', 'getUserId', enumValue('v1', undefined));

      expect(events).toContainEqual(
        expect.objectContaining({
          direction: 'incoming',
          productId: 'product.dot',
          payload: expect.objectContaining({ trait: 'account', method: 'getUserId', leg: 'request' }),
        }),
      );
    });
  });
});
