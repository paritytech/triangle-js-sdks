import type { Provider } from '@novasamatech/host-api';
import {
  CALL_ERROR_FAILURE,
  CoinPaymentErr,
  GenericError,
  PaymentStatusErr,
  PocketRemoveCardErr,
  StorageReadV2Err,
  callErrorMarker,
  createDefaultLogger,
  createTransport,
  enumValue,
  resultErr,
  resultOk,
} from '@novasamatech/host-api';
import { createNanoEvents } from 'nanoevents';
import { describe, expect, it, vi } from 'vitest';

import { createAccountsProvider } from './accounts.js';
import { createCoinPayment } from './coinPayment.js';
import { createContacts } from './contacts.js';
import { createLocalStorage } from './localStorage.js';
import { createPaymentManager } from './payments.js';
import { createPocket } from './pocket.js';
import { createThemeProvider } from './theme.js';

function createTransports() {
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
    host: createTransport(createProvider('toHost', 'toSdk')),
    product: createTransport(createProvider('toSdk', 'toHost')),
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('subscription interrupts', () => {
  it('reports a clean completion as undefined and a domain error as is', async () => {
    const { host, product } = createTransports();
    const theme = { name: enumValue('Default', undefined), variant: 'Dark' as const };
    host.handleSubscription('theme', 'subscribe', (_, send, interrupt) => {
      send(enumValue('v1', theme));
      interrupt(enumValue('v1', undefined));
      return vi.fn();
    });
    const onTheme = vi.fn();
    const onInterrupt = vi.fn();

    createThemeProvider(product).subscribeTheme(onTheme).onInterrupt(onInterrupt);
    await flush();

    expect(onTheme).toHaveBeenCalledWith(theme);
    expect(onInterrupt).toHaveBeenCalledWith(undefined);
  });

  it('folds a transport failure into the domain error', async () => {
    const { host, product } = createTransports();
    host.handleSubscription('payment', 'statusSubscribe', (_, _send, interrupt) => {
      interrupt(enumValue('v1', callErrorMarker({ tag: 'HostFailure', value: { reason: 'offline' } })));
      return vi.fn();
    });
    host.handleSubscription('theme', 'subscribe', (_, _send, interrupt) => {
      interrupt(enumValue('v1', callErrorMarker({ tag: 'Denied' })));
      return vi.fn();
    });
    host.handleSubscription('coinPayment', 'deposit', (_, _send, interrupt) => {
      interrupt(enumValue('v1', callErrorMarker({ tag: 'Unsupported' })));
      return vi.fn();
    });
    const onPaymentInterrupt = vi.fn();
    const onThemeInterrupt = vi.fn();
    const onDepositInterrupt = vi.fn();

    createPaymentManager(product).subscribePaymentStatus(new Uint8Array(32), vi.fn()).onInterrupt(onPaymentInterrupt);
    createThemeProvider(product).subscribeTheme(vi.fn()).onInterrupt(onThemeInterrupt);
    createCoinPayment(product)
      .deposit({ id: `0x${'11'.repeat(32)}`, amount: 1, encryptedSecrets: '0x' }, vi.fn())
      .onInterrupt(onDepositInterrupt);
    await flush();

    const [paymentReason] = onPaymentInterrupt.mock.calls[0] ?? [];
    expect(paymentReason).toEqual(new PaymentStatusErr.Unknown({ reason: 'host failure: offline' }));
    expect(CALL_ERROR_FAILURE in paymentReason).toBe(false);
    expect(onThemeInterrupt).toHaveBeenCalledWith(new GenericError({ reason: 'call denied by host' }));
    expect(onDepositInterrupt).toHaveBeenCalledWith(new CoinPaymentErr.Internal());
  });
});

describe('createPocket', () => {
  it('streams the card set and removes cards', async () => {
    const { host, product } = createTransports();
    const cards = [{ cardId: 'ticket', privileged: false }];
    host.handleSubscription('pocket', 'listSubscribe', (_, send) => {
      send(enumValue('v1', { cards }));
      return vi.fn();
    });
    const removeCard = vi.fn(async ({ value }: { value: { cardId: string } }) =>
      enumValue(
        'v1',
        value.cardId === 'privileged' ? resultErr(new PocketRemoveCardErr.Privileged()) : resultOk(undefined),
      ),
    );
    host.handleRequest('pocket', 'removeCard', removeCard);
    const pocket = createPocket(product);
    const onCards = vi.fn();

    pocket.subscribeCards(onCards);
    await flush();

    expect(onCards).toHaveBeenCalledWith(cards);
    await expect(pocket.removeCard('ticket')).resolves.toBeUndefined();
    await expect(pocket.removeCard('privileged')).rejects.toEqual(new PocketRemoveCardErr.Privileged());
    expect(removeCard.mock.calls[0]?.[0]).toEqual(enumValue('v1', { cardId: 'ticket' }));
  });
});

describe('createContacts', () => {
  it('maps each pick outcome', async () => {
    const { host, product } = createTransports();
    const handle = { bytes: new Uint8Array(32).fill(1) };
    const outcomes = [
      enumValue('Picked', { handle }),
      enumValue('Dismissed', undefined),
      enumValue('NoContacts', undefined),
    ] as const;
    let call = 0;
    host.handleRequest('contacts', 'pick', async () =>
      enumValue('v1', resultOk({ outcome: outcomes[call++] ?? outcomes[0] })),
    );
    const contacts = createContacts(product);

    await expect(contacts.pick()).resolves.toEqual({ type: 'picked', handle });
    await expect(contacts.pick()).resolves.toEqual({ type: 'dismissed' });
    await expect(contacts.pick()).resolves.toEqual({ type: 'noContacts' });
  });
});

describe('createTransaction contacts', () => {
  const txPayload = {
    version: 1,
    signer: null,
    callData: '0x0102',
    extensions: [],
    txExtVersion: 0,
    context: {
      metadata: '0x',
      tokenSymbol: 'DOT',
      tokenDecimals: 10,
      bestBlockHeight: 0,
      genesisHash: `0x${'00'.repeat(32)}`,
    },
  };

  async function captureContacts(
    options?: Parameters<ReturnType<typeof createAccountsProvider>['getProductAccountSigner']>[2],
  ) {
    const { host, product } = createTransports();
    const handler = vi.fn(async () => enumValue('v1', resultOk(new Uint8Array([0xaa]))));
    host.handleRequest('signing', 'createTransaction', handler);

    const signer = createAccountsProvider(product).getProductAccountSigner(
      { dotNsIdentifier: 'product.dot', derivationIndex: 0, publicKey: new Uint8Array(32) },
      'createTransaction',
      options,
    );
    await expect((signer as never as (...args: unknown[]) => Promise<string>)(txPayload, {}, {}, false)).resolves.toBe(
      '0xaa',
    );

    return (handler.mock.calls[0] as unknown[] | undefined)?.[0];
  }

  it('sends no contacts by default', async () => {
    expect(await captureContacts()).toMatchObject({ tag: 'v1', value: { contacts: [] } });
  });

  it('sends the given contact handles', async () => {
    const handle = { bytes: new Uint8Array(32).fill(2) };
    expect(await captureContacts({ contacts: [handle] })).toMatchObject({ tag: 'v1', value: { contacts: [handle] } });
  });
});

describe('signRawUnwatermarkedDeprecated', () => {
  it('signs through the unwatermarked product and legacy account methods', async () => {
    const { host, product } = createTransports();
    const signed = enumValue('v1', resultOk({ signature: '0x01' as const, signedTransaction: undefined }));
    const productHandler = vi.fn(async () => signed);
    const legacyHandler = vi.fn(async () => signed);
    host.handleRequest('signing', 'signRawUnwatermarkedDeprecated', productHandler);
    host.handleRequest('signing', 'signRawUnwatermarkedDeprecatedWithLegacyAccount', legacyHandler);
    const accounts = createAccountsProvider(product);
    const data = new Uint8Array([1, 2, 3]);

    const productResult = await accounts.signRawUnwatermarkedDeprecated(
      { dotNsIdentifier: 'product.dot', derivationIndex: 0, publicKey: new Uint8Array(32) },
      data,
    );
    const legacyResult = await accounts.signRawUnwatermarkedDeprecatedWithLegacyAccount(
      { name: 'Legacy', publicKey: new Uint8Array(32) },
      'text payload',
    );

    expect(productResult._unsafeUnwrap()).toEqual({ signature: '0x01', signedTransaction: undefined });
    expect(legacyResult._unsafeUnwrap()).toEqual({ signature: '0x01', signedTransaction: undefined });
    expect((productHandler.mock.calls[0] as unknown[] | undefined)?.[0]).toMatchObject({
      tag: 'v1',
      value: { payload: { tag: 'Bytes', value: data } },
    });
    expect((legacyHandler.mock.calls[0] as unknown[] | undefined)?.[0]).toMatchObject({
      tag: 'v1',
      value: { payload: { tag: 'Payload', value: 'text payload' } },
    });
  });
});

describe('createLocalStorage', () => {
  it("reads the product's own storage with v1 and another product's with v2", async () => {
    const { host, product } = createTransports();
    const read = vi.fn(async (request: { tag: 'v1'; value: string } | { tag: 'v2'; value: { product?: string } }) => {
      if (request.tag === 'v1') return enumValue('v1', resultOk(new TextEncoder().encode('own')));
      return request.value.product === 'granted.dot'
        ? enumValue('v2', resultOk(new TextEncoder().encode('foreign')))
        : enumValue('v2', resultErr(new StorageReadV2Err.AccessNotGranted()));
    });
    host.handleRequest('localStorage', 'read', read as never);
    const storage = createLocalStorage(product);

    await expect(storage.readString('key')).resolves.toBe('own');
    await expect(storage.readString('key', 'granted.dot')).resolves.toBe('foreign');
    await expect(storage.readBytes('key', 'other.dot')).rejects.toEqual(new StorageReadV2Err.AccessNotGranted());
    expect(read.mock.calls.map(([request]) => request)).toEqual([
      enumValue('v1', 'key'),
      enumValue('v2', { product: 'granted.dot', key: 'key' }),
      enumValue('v2', { product: 'other.dot', key: 'key' }),
    ]);
  });
});
