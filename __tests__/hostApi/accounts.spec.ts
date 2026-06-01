import type { CodecType } from '@novasamatech/host-api';
import {
  CreateProofErr,
  GetUserIdErr,
  LoginErr,
  RequestCredentialsErr,
  RingLocation,
  SigningErr,
  createTransport,
  toHex,
} from '@novasamatech/host-api';
import type { AccountConnectionStatus, LegacyAccount, ProductAccount } from '@novasamatech/host-api-wrapper';
import { createAccountsProvider } from '@novasamatech/host-api-wrapper';
import type { ContainerHandlerOf } from '@novasamatech/host-container';
import { createContainer } from '@novasamatech/host-container';

import { AccountId } from 'polkadot-api';
import { describe, expect, it, vi } from 'vitest';

import { delay } from './__mocks__/helpers.js';
import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

function setup() {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host);
  const sdkTransport = createTransport(providers.sdk);
  const accountsProvider = createAccountsProvider(sdkTransport);

  return { container, accountsProvider };
}

const mockPublicKey = new Uint8Array(32).fill(1);
const mockProductAccount: ProductAccount = {
  dotNsIdentifier: 'product.dot',
  derivationIndex: 0,
  publicKey: mockPublicKey,
};
const mockLegacyAccount: LegacyAccount = {
  publicKey: mockPublicKey,
  name: 'Test Account',
};

const mockRingLocation: CodecType<typeof RingLocation> = {
  genesisHash: toHex(new Uint8Array(32).fill(0x22)),
  ringRootHash: toHex(new Uint8Array(32).fill(0x03)),
  hints: undefined,
};

describe('Host API: Accounts', () => {
  describe('getUserId', () => {
    it('should return primary username on success', async () => {
      const { container, accountsProvider } = setup();
      const expected = { primaryUsername: 'alice.dot' };

      container.handleGetUserId((_, { ok }) => ok(expected));

      const result = await accountsProvider.getUserId();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual(expected);
    });

    it('should return PermissionDenied error when user denies disclosure', async () => {
      const { container, accountsProvider } = setup();
      const error = new GetUserIdErr.PermissionDenied();

      container.handleGetUserId((_, { err }) => err(error));

      const result = await accountsProvider.getUserId();

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toEqual(error);
    });

    it('should return NotConnected error when user is not logged in', async () => {
      const { container, accountsProvider } = setup();
      const error = new GetUserIdErr.NotConnected();

      container.handleGetUserId((_, { err }) => err(error));

      const result = await accountsProvider.getUserId();

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toEqual(error);
    });

    it('should return Unknown error on unexpected failure', async () => {
      const { container, accountsProvider } = setup();
      const error = new GetUserIdErr.Unknown({ reason: 'unexpected' });

      container.handleGetUserId((_, { err }) => err(error));

      const result = await accountsProvider.getUserId();

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toEqual(error);
    });
  });

  describe('getProductAccount', () => {
    it('should return account on success', async () => {
      const { container, accountsProvider } = setup();

      container.handleAccountGet((_, { ok }) => ok({ publicKey: mockPublicKey }));

      const result = await accountsProvider.getProductAccount('product.dot', 0);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual(mockProductAccount);
    });

    it('should pass dotNsIdentifier and derivationIndex to handler', async () => {
      const { container, accountsProvider } = setup();
      const handler = vi.fn<ContainerHandlerOf<typeof container.handleAccountGet>>((_, { ok }) =>
        ok({ publicKey: mockPublicKey }),
      );
      container.handleAccountGet(handler);

      await accountsProvider.getProductAccount('my-product.dot', 3);

      expect(handler).toBeCalledWith(['my-product.dot', 3], expect.anything());
    });

    it('should use derivation index 0 by default', async () => {
      const { container, accountsProvider } = setup();
      const handler = vi.fn<ContainerHandlerOf<typeof container.handleAccountGet>>((_, { ok }) =>
        ok({ publicKey: mockPublicKey }),
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
      const handler = vi.fn<ContainerHandlerOf<typeof container.handleAccountGetAlias>>((_, { ok }) =>
        ok({ context: new Uint8Array(32), alias: new Uint8Array(0) }),
      );
      container.handleAccountGetAlias(handler);

      await accountsProvider.getProductAccountAlias('my-product.dot', 2);

      expect(handler).toBeCalledWith(['my-product.dot', 2], expect.anything());
    });

    it('should use derivation index 0 by default', async () => {
      const { container, accountsProvider } = setup();
      const handler = vi.fn<ContainerHandlerOf<typeof container.handleAccountGetAlias>>((_, { ok }) =>
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

  describe('getLegacyAccounts', () => {
    it('should return list of accounts', async () => {
      const { container, accountsProvider } = setup();
      const accounts = [
        { publicKey: new Uint8Array(32).fill(1), name: 'Alice' },
        { publicKey: new Uint8Array(32).fill(2), name: undefined },
      ];

      container.handleGetLegacyAccounts((_, { ok }) => ok(accounts));

      const result = await accountsProvider.getLegacyAccounts();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual(accounts);
    });

    it('should return empty list when no accounts', async () => {
      const { container, accountsProvider } = setup();

      container.handleGetLegacyAccounts((_, { ok }) => ok([]));

      const result = await accountsProvider.getLegacyAccounts();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual([]);
    });

    it('should return error on failure', async () => {
      const { container, accountsProvider } = setup();
      const error = new RequestCredentialsErr.Rejected();

      container.handleGetLegacyAccounts((_, { err }) => err(error));

      const result = await accountsProvider.getLegacyAccounts();

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toEqual(error);
    });
  });

  describe('getLegacyAccountSigner', () => {
    it('sends the wire signer as an SS58 address, not a hex public key', async () => {
      const { container, accountsProvider } = setup();

      let capturedSigner: string | undefined;
      container.handleSignRawWithLegacyAccount((params, { ok }) => {
        capturedSigner = params.signer;
        return ok({
          signature: toHex(new Uint8Array(64).fill(7)),
          signedTransaction: undefined,
        });
      });

      const signer = accountsProvider.getLegacyAccountSigner(mockLegacyAccount);
      await signer.signBytes(new TextEncoder().encode('hello'));

      expect(capturedSigner).toBeDefined();
      // Regression guard for the legacy-account signing bug: the wallet matches
      // accounts by SS58 address, so the signer must NOT be a raw hex pubkey.
      expect(capturedSigner!.startsWith('0x')).toBe(false);
      // ...and it must round-trip back to the account's public key.
      const accountId = AccountId();
      expect(toHex(accountId.enc(capturedSigner!))).toBe(toHex(mockPublicKey));
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
      const handler = vi.fn<ContainerHandlerOf<typeof container.handleAccountCreateProof>>((_, { ok }) =>
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
      const handler = vi.fn<ContainerHandlerOf<typeof container.handleAccountCreateProof>>((_, { ok }) =>
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
      const signer = accountsProvider.getProductAccountSigner(mockProductAccount);

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

      const signer = accountsProvider.getProductAccountSigner(mockProductAccount);
      const result = await signer.signBytes(rawData);

      expect(capturedParams).toEqual({
        account: [mockProductAccount.dotNsIdentifier, mockProductAccount.derivationIndex],
        payload: { tag: 'Bytes', value: rawData },
      });
      expect(result).toEqual(signatureBytes);
    });

    it('should throw on sign bytes error', async () => {
      const { container, accountsProvider } = setup();
      const error = new SigningErr.Rejected();

      container.handleSignRaw((_, { err }) => err(error));

      const signer = accountsProvider.getProductAccountSigner(mockProductAccount);

      await expect(signer.signBytes(new Uint8Array([1, 2, 3]))).rejects.toEqual(error);
    });
  });

  describe('getLegacyAccountSigner', () => {
    it('should expose the correct public key', () => {
      const { accountsProvider } = setup();
      const signer = accountsProvider.getLegacyAccountSigner(mockLegacyAccount);

      expect(signer.publicKey).toEqual(mockPublicKey);
    });

    it('should sign bytes via handleSignRawWithLegacyAccount', async () => {
      const { container, accountsProvider } = setup();
      const rawData = new Uint8Array([5, 6, 7, 8]);
      const signatureBytes = new Uint8Array(64).fill(0xef);
      let capturedParams: unknown;

      container.handleSignRawWithLegacyAccount((params, { ok }) => {
        capturedParams = params;
        return ok({ signature: toHex(signatureBytes), signedTransaction: undefined });
      });

      const signer = accountsProvider.getLegacyAccountSigner(mockLegacyAccount);
      const result = await signer.signBytes(rawData);

      expect(capturedParams).toMatchObject({ payload: { tag: 'Bytes', value: rawData } });
      expect(result).toEqual(signatureBytes);
    });

    it('should throw on sign bytes error', async () => {
      const { container, accountsProvider } = setup();
      const error = new SigningErr.Rejected();

      container.handleSignRawWithLegacyAccount((_, { err }) => err(error));

      const signer = accountsProvider.getLegacyAccountSigner(mockLegacyAccount);

      await expect(signer.signBytes(new Uint8Array([1, 2, 3]))).rejects.toEqual(error);
    });
  });

  describe('requestLogin', () => {
    it('should return success when login completes', async () => {
      const { container, accountsProvider } = setup();

      container.handleRequestLogin((_, { ok }) => ok('success'));

      const result = await accountsProvider.requestLogin();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe('success');
    });

    it('should return alreadyConnected when user is already logged in', async () => {
      const { container, accountsProvider } = setup();

      container.handleRequestLogin((_, { ok }) => ok('alreadyConnected'));

      const result = await accountsProvider.requestLogin('some reason');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe('alreadyConnected');
    });

    it('should return rejected when user dismisses login UI', async () => {
      const { container, accountsProvider } = setup();

      container.handleRequestLogin((_, { ok }) => ok('rejected'));

      const result = await accountsProvider.requestLogin();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe('rejected');
    });

    it('should pass reason string to handler', async () => {
      const { container, accountsProvider } = setup();
      const handler = vi.fn<ContainerHandlerOf<typeof container.handleRequestLogin>>((_, { ok }) => ok('success'));
      container.handleRequestLogin(handler);

      await accountsProvider.requestLogin('Sign in to vote');

      expect(handler).toBeCalledWith('Sign in to vote', expect.anything());
    });

    it('should pass undefined reason when no reason given', async () => {
      const { container, accountsProvider } = setup();
      const handler = vi.fn<ContainerHandlerOf<typeof container.handleRequestLogin>>((_, { ok }) => ok('success'));
      container.handleRequestLogin(handler);

      await accountsProvider.requestLogin();

      expect(handler).toBeCalledWith(undefined, expect.anything());
    });

    it('should return error on unknown failure', async () => {
      const { container, accountsProvider } = setup();
      const error = new LoginErr.Unknown({ reason: 'host crashed' });

      container.handleRequestLogin((_, { err }) => err(error));

      const result = await accountsProvider.requestLogin();

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toEqual(error);
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
