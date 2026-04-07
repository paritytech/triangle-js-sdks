import type { CodecType } from '@novasamatech/host-api';
import {
  CreateProofErr,
  RequestCredentialsErr,
  RingLocation,
  SigningErr,
  createTransport,
  toHex,
} from '@novasamatech/host-api';
import { createContainer } from '@novasamatech/host-container';
import type { AccountConnectionStatus, ProductAccount } from '@novasamatech/product-sdk';
import { createAccountsProvider } from '@novasamatech/product-sdk';

import { describe, expect, it, vi } from 'vitest';

import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

function delay(ttl: number) {
  return new Promise(resolve => setTimeout(resolve, ttl));
}

function setup() {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host);
  const sdkTransport = createTransport(providers.sdk);
  const accountsProvider = createAccountsProvider(sdkTransport);

  return { container, accountsProvider };
}

const mockPublicKey = new Uint8Array(32).fill(1);
const mockAccount: ProductAccount = {
  dotNsIdentifier: 'product.dot',
  derivationIndex: 0,
  publicKey: mockPublicKey,
};

const mockRingLocation: CodecType<typeof RingLocation> = {
  genesisHash: toHex(new Uint8Array(32).fill(0x22)),
  ringRootHash: toHex(new Uint8Array(32).fill(0x03)),
  hints: undefined,
};

describe('Host API: Accounts', () => {
  describe('getProductAccount', () => {
    it('should return account on success', async () => {
      const { container, accountsProvider } = setup();
      const expected = { publicKey: mockPublicKey, name: 'Alice' };

      container.handleAccountGet((_, { ok }) => ok(expected));

      const result = await accountsProvider.getProductAccount('product.dot', 0);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual(expected);
    });

    it('should pass dotNsIdentifier and derivationIndex to handler', async () => {
      const { container, accountsProvider } = setup();
      const handler = vi.fn<Parameters<typeof container.handleAccountGet>[0]>((_, { ok }) =>
        ok({ publicKey: mockPublicKey, name: undefined }),
      );
      container.handleAccountGet(handler);

      await accountsProvider.getProductAccount('my-product.dot', 3);

      expect(handler).toBeCalledWith(['my-product.dot', 3], expect.anything());
    });

    it('should use derivation index 0 by default', async () => {
      const { container, accountsProvider } = setup();
      const handler = vi.fn<Parameters<typeof container.handleAccountGet>[0]>((_, { ok }) =>
        ok({ publicKey: mockPublicKey, name: undefined }),
      );
      container.handleAccountGet(handler);

      await accountsProvider.getProductAccount('product.dot');

      expect(handler).toBeCalledWith(['product.dot', 0], expect.anything());
    });

    it('should return error on failure', async () => {
      const { container, accountsProvider } = setup();
      const error = new RequestCredentialsErr.NotConnected();

      container.handleAccountGet((_, { err }) => err(error));

      const result = await accountsProvider.getProductAccount('product.dot', 0);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toEqual(error);
    });

    it('should handle account with no name', async () => {
      const { container, accountsProvider } = setup();

      container.handleAccountGet((_, { ok }) => ok({ publicKey: mockPublicKey, name: undefined }));

      const result = await accountsProvider.getProductAccount('product.dot', 0);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().name).toBeUndefined();
    });
  });

  describe('getProductAccountAlias', () => {
    it('should return alias on success', async () => {
      const { container, accountsProvider } = setup();
      const expected = { context: new Uint8Array(32).fill(5), alias: new Uint8Array([1, 2, 3]) };

      container.handleAccountGetAlias((_, { ok }) => ok(expected));

      const result = await accountsProvider.getProductAccountAlias('product.dot', 0);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual(expected);
    });

    it('should pass dotNsIdentifier and derivationIndex to handler', async () => {
      const { container, accountsProvider } = setup();
      const handler = vi.fn<Parameters<typeof container.handleAccountGetAlias>[0]>((_, { ok }) =>
        ok({ context: new Uint8Array(32), alias: new Uint8Array(0) }),
      );
      container.handleAccountGetAlias(handler);

      await accountsProvider.getProductAccountAlias('my-product.dot', 2);

      expect(handler).toBeCalledWith(['my-product.dot', 2], expect.anything());
    });

    it('should use derivation index 0 by default', async () => {
      const { container, accountsProvider } = setup();
      const handler = vi.fn<Parameters<typeof container.handleAccountGetAlias>[0]>((_, { ok }) =>
        ok({ context: new Uint8Array(32), alias: new Uint8Array(0) }),
      );
      container.handleAccountGetAlias(handler);

      await accountsProvider.getProductAccountAlias('product.dot');

      expect(handler).toBeCalledWith(['product.dot', 0], expect.anything());
    });

    it('should return error on failure', async () => {
      const { container, accountsProvider } = setup();
      const error = new RequestCredentialsErr.Rejected();

      container.handleAccountGetAlias((_, { err }) => err(error));

      const result = await accountsProvider.getProductAccountAlias('product.dot', 0);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toEqual(error);
    });
  });

  describe('getNonProductAccounts', () => {
    it('should return list of accounts', async () => {
      const { container, accountsProvider } = setup();
      const accounts = [
        { publicKey: new Uint8Array(32).fill(1), name: 'Alice' },
        { publicKey: new Uint8Array(32).fill(2), name: undefined },
      ];

      container.handleGetNonProductAccounts((_, { ok }) => ok(accounts));

      const result = await accountsProvider.getNonProductAccounts();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual(accounts);
    });

    it('should return empty list when no accounts', async () => {
      const { container, accountsProvider } = setup();

      container.handleGetNonProductAccounts((_, { ok }) => ok([]));

      const result = await accountsProvider.getNonProductAccounts();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual([]);
    });

    it('should return error on failure', async () => {
      const { container, accountsProvider } = setup();
      const error = new RequestCredentialsErr.Rejected();

      container.handleGetNonProductAccounts((_, { err }) => err(error));

      const result = await accountsProvider.getNonProductAccounts();

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toEqual(error);
    });
  });

  describe('createRingVRFProof', () => {
    it('should return proof on success', async () => {
      const { container, accountsProvider } = setup();
      const expectedProof = new Uint8Array([10, 20, 30]);

      container.handleAccountCreateProof((_, { ok }) => ok(expectedProof));

      const result = await accountsProvider.createRingVRFProof('product.dot', 0, mockRingLocation, new Uint8Array([1]));

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual(expectedProof);
    });

    it('should pass correct params to handler', async () => {
      const { container, accountsProvider } = setup();
      const message = new Uint8Array([7, 8, 9]);
      const handler = vi.fn<Parameters<typeof container.handleAccountCreateProof>[0]>((_, { ok }) =>
        ok(new Uint8Array(0)),
      );
      container.handleAccountCreateProof(handler);

      await accountsProvider.createRingVRFProof('product.dot', 1, mockRingLocation, message);

      expect(handler).toBeCalledWith([['product.dot', 1], mockRingLocation, message], {
        ok: expect.any(Function),
        err: expect.any(Function),
      });
    });

    it('should use derivation index 0 by default', async () => {
      const { container, accountsProvider } = setup();
      const handler = vi.fn<Parameters<typeof container.handleAccountCreateProof>[0]>((_, { ok }) =>
        ok(new Uint8Array(0)),
      );
      container.handleAccountCreateProof(handler);

      await accountsProvider.createRingVRFProof('product.dot', 0, mockRingLocation, new Uint8Array(0));

      expect(handler).toBeCalledWith([['product.dot', 0], mockRingLocation, new Uint8Array(0)], {
        ok: expect.any(Function),
        err: expect.any(Function),
      });
    });

    it('should return error when ring not found', async () => {
      const { container, accountsProvider } = setup();
      const error = new CreateProofErr.RingNotFound();

      container.handleAccountCreateProof((_, { err }) => err(error));

      const result = await accountsProvider.createRingVRFProof('product.dot', 0, mockRingLocation, new Uint8Array(0));

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toEqual(error);
    });

    it('should return error when rejected', async () => {
      const { container, accountsProvider } = setup();
      const error = new CreateProofErr.Rejected();

      container.handleAccountCreateProof((_, { err }) => err(error));

      const result = await accountsProvider.createRingVRFProof('product.dot', 0, mockRingLocation, new Uint8Array(0));

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toEqual(error);
    });
  });

  describe('getProductAccountSigner', () => {
    it('should expose the correct public key', () => {
      const { accountsProvider } = setup();
      const signer = accountsProvider.getProductAccountSigner(mockAccount);

      expect(signer.publicKey).toEqual(mockPublicKey);
    });

    it('should sign bytes via handleSignRaw', async () => {
      const { container, accountsProvider } = setup();
      const rawData = new Uint8Array([1, 2, 3, 4]);
      const signatureBytes = new Uint8Array(64).fill(0xab);
      let capturedParams: unknown;

      container.handleSignRaw((params, { ok }) => {
        capturedParams = params;
        return ok({ signature: toHex(signatureBytes), signedTransaction: undefined });
      });

      const signer = accountsProvider.getProductAccountSigner(mockAccount);
      const result = await signer.signBytes(rawData);

      expect(capturedParams).toEqual({
        account: [mockAccount.dotNsIdentifier, mockAccount.derivationIndex],
        payload: { tag: 'Bytes', value: rawData },
      });
      expect(result).toEqual(signatureBytes);
    });

    it('should throw on sign bytes error', async () => {
      const { container, accountsProvider } = setup();
      const error = new SigningErr.Rejected();

      container.handleSignRaw((_, { err }) => err(error));

      const signer = accountsProvider.getProductAccountSigner(mockAccount);

      await expect(signer.signBytes(new Uint8Array([1, 2, 3]))).rejects.toEqual(error);
    });

    it('should sign payload via handleSignPayload', async () => {
      const { container, accountsProvider } = setup();
      const signatureBytes = new Uint8Array(64).fill(0xcd);
      let handlerCalled = false;

      container.handleSignPayload((_, { ok }) => {
        handlerCalled = true;
        return ok({ signature: toHex(signatureBytes), signedTransaction: undefined });
      });

      const signer = accountsProvider.getProductAccountSigner(mockAccount);
      // Invoke via the PJS signPayload interface underlying the PolkadotSigner
      const pjsSignPayload = (signer as unknown as { _signPayload: (p: unknown) => Promise<unknown> })._signPayload;
      if (pjsSignPayload) {
        await pjsSignPayload.call(signer, {
          address: '0x00',
          genesisHash: '0x00',
          nonce: '0x00',
          method: '0x0002',
          blockHash: '0x00',
          blockNumber: '0x00',
          era: '0x00',
          version: 4,
          specVersion: '0x00',
          tip: '0x00',
          signedExtensions: [],
          transactionVersion: '0x00',
        });
        expect(handlerCalled).toBe(true);
      }
    });
  });

  describe('getNonProductAccountSigner', () => {
    it('should expose the correct public key', () => {
      const { accountsProvider } = setup();
      const signer = accountsProvider.getNonProductAccountSigner(mockAccount);

      expect(signer.publicKey).toEqual(mockPublicKey);
    });

    it('should sign bytes via handleSignRawWithNonProductAccount', async () => {
      const { container, accountsProvider } = setup();
      const rawData = new Uint8Array([5, 6, 7, 8]);
      const signatureBytes = new Uint8Array(64).fill(0xef);
      let capturedParams: unknown;

      container.handleSignRawWithNonProductAccount((params, { ok }) => {
        capturedParams = params;
        return ok({ signature: toHex(signatureBytes), signedTransaction: undefined });
      });

      const signer = accountsProvider.getNonProductAccountSigner(mockAccount);
      const result = await signer.signBytes(rawData);

      expect(capturedParams).toMatchObject({ payload: { tag: 'Bytes', value: rawData } });
      expect(result).toEqual(signatureBytes);
    });

    it('should throw on sign bytes error', async () => {
      const { container, accountsProvider } = setup();
      const error = new SigningErr.Rejected();

      container.handleSignRawWithNonProductAccount((_, { err }) => err(error));

      const signer = accountsProvider.getNonProductAccountSigner(mockAccount);

      await expect(signer.signBytes(new Uint8Array([1, 2, 3]))).rejects.toEqual(error);
    });
  });

  describe('subscribeAccountConnectionStatus', () => {
    it('should receive connection status updates from host', async () => {
      const { container, accountsProvider } = setup();

      container.handleAccountConnectionStatusSubscribe((_, send) => {
        send('connected');
        return () => {
          /* cleanup */
        };
      });

      const statuses: AccountConnectionStatus[] = [];
      accountsProvider.subscribeAccountConnectionStatus(status => {
        statuses.push(status);
      });

      await delay(10);

      expect(statuses).toEqual(['connected']);
    });

    it('should receive multiple status updates', async () => {
      const { container, accountsProvider } = setup();

      container.handleAccountConnectionStatusSubscribe((_, send) => {
        send('disconnected');
        send('connected');
        send('disconnected');
        return () => {
          /* cleanup */
        };
      });

      const statuses: AccountConnectionStatus[] = [];
      accountsProvider.subscribeAccountConnectionStatus(status => {
        statuses.push(status);
      });

      await delay(10);

      expect(statuses).toEqual(['disconnected', 'connected', 'disconnected']);
    });

    it('should stop receiving updates after unsubscribe', async () => {
      const { container, accountsProvider } = setup();
      let sendStatus: ((status: AccountConnectionStatus) => void) | undefined;
      const cleanupFn = vi.fn();

      container.handleAccountConnectionStatusSubscribe((_, send) => {
        sendStatus = send;
        return cleanupFn;
      });

      const callback = vi.fn();
      const subscription = accountsProvider.subscribeAccountConnectionStatus(callback);

      await delay(10);

      subscription.unsubscribe();

      await delay(10);

      sendStatus?.('connected');

      await delay(10);

      expect(callback).not.toHaveBeenCalled();
      expect(cleanupFn).toHaveBeenCalled();
    });

    it('should call cleanup handler on unsubscribe', async () => {
      const { container, accountsProvider } = setup();
      const cleanupFn = vi.fn();

      container.handleAccountConnectionStatusSubscribe((_, send) => {
        send('connected');
        return cleanupFn;
      });

      const subscription = accountsProvider.subscribeAccountConnectionStatus(vi.fn());

      await delay(10);

      subscription.unsubscribe();

      await delay(10);

      expect(cleanupFn).toHaveBeenCalledOnce();
    });
  });
});
