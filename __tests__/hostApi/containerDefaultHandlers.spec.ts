import { LoginErr, RequestCredentialsErr, StorageErr, createTransport } from '@novasamatech/host-api';
import { createContainer } from '@novasamatech/host-container';
import { createAccountsProvider, createLocalStorage } from '@novasamatech/product-sdk';

import { describe, expect, it, vi } from 'vitest';

import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

function setup() {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host);
  const sdkTransport = createTransport(providers.sdk);
  const accountsProvider = createAccountsProvider(sdkTransport);
  const localStorage = createLocalStorage(sdkTransport);

  return { container, accountsProvider, localStorage };
}

describe('Container default handlers', () => {
  describe('unregistered request handler returns not-implemented error', () => {
    it('handleRequestLogin default returns LoginErr.Unknown', async () => {
      const { accountsProvider } = setup();
      // No container.handleRequestLogin(...) call — default is active

      const result = await accountsProvider.requestLogin();

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error).toBeInstanceOf(LoginErr.Unknown);
      expect(error.payload?.reason).toBe('Not implemented');
    });

    it('handleAccountGet default returns RequestCredentialsErr.Unknown', async () => {
      const { accountsProvider } = setup();
      // No container.handleAccountGet(...) call — default is active

      const result = await accountsProvider.getProductAccount('product.dot', 0);

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error).toBeInstanceOf(RequestCredentialsErr.Unknown);
      expect(error.payload?.reason).toBe('Not implemented');
    });

    it('handleLocalStorageRead default returns StorageErr.Unknown', async () => {
      const { localStorage } = setup();
      // No container.handleLocalStorageRead(...) call — default is active

      await expect(localStorage.readBytes('key')).rejects.toBeInstanceOf(StorageErr.Unknown);
    });
  });

  describe('unregistered subscription handler immediately interrupts', () => {
    it('handleAccountConnectionStatusSubscribe default interrupts immediately', async () => {
      const { accountsProvider } = setup();
      // No container.handleAccountConnectionStatusSubscribe(...) call

      const onInterrupt = vi.fn();
      const subscription = accountsProvider.subscribeAccountConnectionStatus(vi.fn());
      subscription.onInterrupt(onInterrupt);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(onInterrupt).toHaveBeenCalledOnce();
    });
  });

  describe('cleanup restores default handler', () => {
    it('after cleanup of handleAccountGet, default not-implemented error is returned', async () => {
      const { container, accountsProvider } = setup();

      // Register user handler
      const cleanup = container.handleAccountGet((_, { ok }) => ok({ publicKey: new Uint8Array(32) }));

      // Verify user handler works
      const okResult = await accountsProvider.getProductAccount('product.dot', 0);
      expect(okResult.isOk()).toBe(true);

      // Call cleanup — should restore default
      cleanup();

      // Verify default is back
      const errResult = await accountsProvider.getProductAccount('product.dot', 0);
      expect(errResult.isErr()).toBe(true);
      expect(errResult._unsafeUnwrapErr()).toBeInstanceOf(RequestCredentialsErr.Unknown);
    });
  });

  describe('slot replacement (double handle* call)', () => {
    it('second handleAccountGet call replaces first without cleanup', async () => {
      const { container, accountsProvider } = setup();

      const firstHandler = vi.fn((_, { ok }) => ok({ publicKey: new Uint8Array(32) }));
      const secondHandler = vi.fn((_, { ok }) => ok({ publicKey: new Uint8Array(32) }));

      container.handleAccountGet(firstHandler);
      container.handleAccountGet(secondHandler); // replaces first

      await accountsProvider.getProductAccount('product.dot', 0);

      expect(firstHandler).not.toHaveBeenCalled();
      expect(secondHandler).toHaveBeenCalledOnce();
    });
  });

  it('post-dispose teardown is idempotent (cleanup callbacks and dispose itself)', () => {
    const { container } = setup();
    const unsub = container.handleGetLegacyAccounts((_, { ok }) => ok([]));

    container.dispose();
    expect(() => unsub()).not.toThrow();
    expect(() => unsub()).not.toThrow();
    expect(() => container.dispose()).not.toThrow();
  });
});
