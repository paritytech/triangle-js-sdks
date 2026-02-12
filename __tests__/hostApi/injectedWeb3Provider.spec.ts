import type { HexString } from '@novasamatech/host-api';
import {
  CreateTransactionErr,
  RequestCredentialsErr,
  SigningErr,
  createTransport,
  toHex,
} from '@novasamatech/host-api';
import { createContainer } from '@novasamatech/host-container';
import { createNonProductExtensionEnableFactory } from '@novasamatech/product-sdk';

import type { SignerResult } from '@polkadot/types/types';
import { AccountId } from '@polkadot-api/substrate-bindings';
import { assert, describe, expect, it, vitest } from 'vitest';

import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

async function setup() {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host);
  const sdkTransport = createTransport(providers.sdk);

  const enable = await createNonProductExtensionEnableFactory(sdkTransport);
  assert(enable, 'Enable function should be available');

  const injected = await enable();

  return { container, injected };
}

describe('Host API: injected web3 provider', () => {
  it('should provide accounts', async () => {
    const accountId = AccountId();
    const mockAccounts = [{ publicKey: new Uint8Array(32), name: 'test' }];

    const { container, injected } = await setup();

    container.handleGetNonProductAccounts((_, { ok }) => ok(mockAccounts));

    const injectedAccounts = await injected.accounts.get();

    expect(injectedAccounts).toEqual([
      {
        name: 'test',
        address: accountId.dec(new Uint8Array(32)),
        type: 'sr25519',
      },
    ]);
  });

  it('should handle signPayload request', async () => {
    const { container, injected } = await setup();

    const payload = '0x0002';
    const signerResult: SignerResult = {
      id: 0,
      signature: '0x0001',
    };

    container.handleSignPayload((params, { ok }) => {
      return ok({ ...signerResult, signedTransaction: params.method });
    });

    const result = await injected.signer.signPayload?.({
      address: '0x00',
      genesisHash: '0x00',
      nonce: '0x00',
      method: payload,
      blockHash: '0x00',
      blockNumber: '0x00',
      era: '0x00',
      version: 4,
      specVersion: '0x00',
      tip: '0x00',
      signedExtensions: [],
      transactionVersion: '0x00',
    });

    expect(result).toEqual({ ...signerResult, signedTransaction: payload });
  });

  it('should handle signRaw request', async () => {
    const { container, injected } = await setup();

    const payload = '0x0002';
    const signerResult: SignerResult = {
      id: 0,
      signature: '0x0001',
    };

    container.handleSignRaw((params, { ok }) => {
      return ok({ ...signerResult, signedTransaction: params.data.value as HexString });
    });

    const result = await injected.signer.signRaw?.({
      address: '0x00',
      type: 'payload',
      data: payload,
    });

    expect(result).toEqual({ ...signerResult, signedTransaction: payload });
  });

  it('should handle createTransaction request', async () => {
    const { container, injected } = await setup();

    const response = new Uint8Array([0, 0, 1, 1]);
    const payload = {
      version: 1 as const,
      signer: 'test',
      callData: '0x0002' as const,
      extensions: [
        {
          id: 'test',
          additionalSigned: '0x0000' as const,
          extra: '0x0000' as const,
        },
      ],
      txExtVersion: 15,
      context: {
        metadata: '0x0000' as const,
        bestBlockHeight: 1,
        tokenSymbol: 'DOT',
        tokenDecimals: 10,
      },
    };

    const createTransaction = vitest.fn<Parameters<typeof container.handleCreateTransactionWithNonProductAccount>[0]>(
      (_, { ok }) => ok(response),
    );

    container.handleCreateTransactionWithNonProductAccount(createTransaction);

    const result = await injected.signer.createTransaction?.(payload);

    expect(createTransaction).toBeCalledTimes(1);
    expect(result).toEqual(toHex(response));
  });

  it('should handle get accounts error', async () => {
    const { container, injected } = await setup();
    const error = new RequestCredentialsErr.Rejected();

    container.handleGetNonProductAccounts((_, { err }) => err(error));

    await expect(injected.accounts.get()).rejects.toEqual(error);
  });

  it('should handle signPayload rejection', async () => {
    const { container, injected } = await setup();
    const error = new SigningErr.Rejected();

    container.handleSignPayload((_, { err }) => err(error));

    await expect(
      injected.signer.signPayload?.({
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
      }),
    ).rejects.toEqual(error);
  });

  it('should handle signRaw rejection', async () => {
    const { container, injected } = await setup();
    const error = new SigningErr.Rejected();

    container.handleSignRaw((_, { err }) => err(error));

    await expect(
      injected.signer.signRaw?.({
        address: '0x00',
        type: 'payload',
        data: '0x0002',
      }),
    ).rejects.toEqual(error);
  });

  it('should handle createTransaction rejection', async () => {
    const { container, injected } = await setup();
    const error = new CreateTransactionErr.Rejected();

    const payload = {
      version: 1 as const,
      signer: 'test',
      callData: '0x0002' as const,
      extensions: [
        {
          id: 'test',
          additionalSigned: '0x0000' as const,
          extra: '0x0000' as const,
        },
      ],
      txExtVersion: 15,
      context: {
        metadata: '0x0000' as const,
        bestBlockHeight: 1,
        tokenSymbol: 'DOT',
        tokenDecimals: 10,
      },
    };

    container.handleCreateTransactionWithNonProductAccount((_, { err }) => err(error));

    await expect(injected.signer.createTransaction?.(payload)).rejects.toEqual(error);
  });
});
