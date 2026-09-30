import { GenericError, LoginErr, RequestCredentialsErr, StorageErr, createTransport } from '@novasamatech/host-api';
import { createAccountsProvider, createLocalStorage } from '@novasamatech/host-api-wrapper';
import { createContainer } from '@novasamatech/host-container';

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
  describe('unregistered request handler answers CallError.Unsupported', () => {
    // The container replies with the transport-level `Unsupported` variant;
    // the wrapper folds it into the method's own `Unknown` error, so the
    // instance type is unchanged and the reason names the unsupported method.
    it('account.handleRequestLogin default folds Unsupported into LoginErr.Unknown', async () => {
      const { accountsProvider } = setup();
      // No container.account.handleRequestLogin(...) call — default is active

      const result = await accountsProvider.requestLogin();

      await expect(result).toBeErr();
      const error = result._unsafeUnwrapErr();
      expect(error).toBeInstanceOf(LoginErr.Unknown);
      expect(error.payload?.reason).toContain('unsupported');
    });

    it('account.handleGetAccount default folds Unsupported into RequestCredentialsErr.Unknown', async () => {
      const { accountsProvider } = setup();
      // No container.account.handleGetAccount(...) call — default is active

      const result = await accountsProvider.getProductAccount('product.dot', 0);

      await expect(result).toBeErr();
      const error = result._unsafeUnwrapErr();
      expect(error).toBeInstanceOf(RequestCredentialsErr.Unknown);
      expect(error.payload?.reason).toContain('unsupported');
    });

    it('localStorage.handleRead default returns StorageErr.Unknown', async () => {
      const { localStorage } = setup();
      // No container.localStorage.handleRead(...) call — default is active

      await expect(localStorage.readBytes('key')).rejects.toBeInstanceOf(StorageErr.Unknown);
    });
  });

  describe('unregistered subscription handler immediately interrupts', () => {
    it('account.handleConnectionStatusSubscribe default interrupts immediately with Unsupported', async () => {
      const { accountsProvider } = setup();
      // No container.account.handleConnectionStatusSubscribe(...) call

      const onInterrupt = vi.fn();
      const subscription = accountsProvider.subscribeAccountConnectionStatus(vi.fn());
      subscription.onInterrupt(onInterrupt);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(onInterrupt).toHaveBeenCalledOnce();
      // The `Unsupported` marker is folded into the method's own error type.
      const [reason] = onInterrupt.mock.calls[0] ?? [];
      expect(reason).toBeInstanceOf(GenericError);
      expect((reason as InstanceType<typeof GenericError>).payload.reason).toContain('unsupported');
    });
  });

  describe('cleanup restores default handler', () => {
    it('after cleanup of account.handleGetAccount, default not-implemented error is returned', async () => {
      const { container, accountsProvider } = setup();

      // Register user handler
      const cleanup = container.account.handleGetAccount((_, { ok }) => ok({ publicKey: new Uint8Array(32) }));

      // Verify user handler works
      const okResult = await accountsProvider.getProductAccount('product.dot', 0);
      await expect(okResult).toBeOk();

      // Call cleanup — should restore default
      cleanup();

      // Verify default is back
      const errResult = await accountsProvider.getProductAccount('product.dot', 0);
      await expect(errResult).toBeErr();
      expect(errResult._unsafeUnwrapErr()).toBeInstanceOf(RequestCredentialsErr.Unknown);
    });
  });

  describe('slot replacement (double handle* call)', () => {
    it('second account.handleGetAccount call replaces first without cleanup', async () => {
      const { container, accountsProvider } = setup();

      const firstHandler = vi.fn((_, { ok }) => ok({ publicKey: new Uint8Array(32) }));
      const secondHandler = vi.fn((_, { ok }) => ok({ publicKey: new Uint8Array(32) }));

      container.account.handleGetAccount(firstHandler);
      container.account.handleGetAccount(secondHandler); // replaces first

      await accountsProvider.getProductAccount('product.dot', 0);

      expect(firstHandler).not.toHaveBeenCalled();
      expect(secondHandler).toHaveBeenCalledOnce();
    });
  });

  it('post-dispose teardown is idempotent (cleanup callbacks and dispose itself)', () => {
    const { container } = setup();
    const unsub = container.account.handleGetLegacyAccounts((_, { ok }) => ok([]));

    container.dispose();
    expect(() => unsub()).not.toThrow();
    expect(() => unsub()).not.toThrow();
    expect(() => container.dispose()).not.toThrow();
  });
});
