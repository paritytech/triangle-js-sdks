import { GenericError, StatementProofErr, createTransport, enumValue } from '@novasamatech/host-api';
import type { ContainerHandlerOf } from '@novasamatech/host-container';
import { createContainer } from '@novasamatech/host-container';
import type {
  ProductAccountId,
  SignedStatement,
  Statement,
  StatementTopicFilter,
  Topic,
} from '@novasamatech/product-sdk';
import { createStatementStore } from '@novasamatech/product-sdk';

import { describe, expect, it, vi } from 'vitest';

import { delay } from './__mocks__/helpers.js';
import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

function setup() {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host);
  const sdkTransport = createTransport(providers.sdk);
  const statementStore = createStatementStore(sdkTransport);

  return { container, statementStore };
}

// Helper to create a 32-byte topic
function createTopic(seed: number): Topic {
  const bytes = new Uint8Array(32);
  bytes[0] = seed;
  return bytes;
}

// Helper to create a mock signed statement
function createMockSignedStatement(topicSeed: number): SignedStatement {
  return {
    proof: enumValue('Sr25519', {
      signature: new Uint8Array(64).fill(1),
      signer: new Uint8Array(32).fill(2),
    }),
    decryptionKey: undefined,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60) << 32n,
    channel: undefined,
    topics: [createTopic(topicSeed)],
    data: new Uint8Array([1, 2, 3]),
  };
}

// Helper to create a mock statement (without proof required)
function createMockStatement(topicSeed: number): Statement {
  return {
    proof: undefined,
    decryptionKey: undefined,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60) << 32n,
    channel: undefined,
    topics: [createTopic(topicSeed)],
    data: new Uint8Array([1, 2, 3]),
  };
}

// Helper to create a ProductAccountId
function createMockAccountId(): ProductAccountId {
  return ['test.dot', 0];
}

describe('Host API: StatementStore', () => {
  it('should subscribe to statement updates', async () => {
    const { container, statementStore } = setup();
    const filter: StatementTopicFilter = { matchAll: [createTopic(1)] };
    const statement1 = createMockSignedStatement(1);
    const statement2 = createMockSignedStatement(2);

    container.handleStatementStoreSubscribe((params, send) => {
      expect(params).toEqual({ tag: 'MatchAll', value: [createTopic(1)] });
      // Simulate sending updates
      send({ statements: [statement1, statement2], isComplete: true });
      return () => {
        /* cleanup */
      };
    });

    const callback = vi.fn();
    statementStore.subscribe(filter, callback);

    // Wait for async message passing
    await delay(10);

    expect(callback).toHaveBeenNthCalledWith(1, { statements: [statement1, statement2], isComplete: true });
  });

  it('should create proof for a statement', async () => {
    const { container, statementStore } = setup();
    const accountId = createMockAccountId();
    const statement = createMockStatement(1);
    const expectedProof = enumValue('Sr25519', {
      signature: new Uint8Array(64).fill(5),
      signer: new Uint8Array(32).fill(6),
    });

    const handler = vi.fn<ContainerHandlerOf<typeof container.handleStatementStoreCreateProof>>((_, { ok }) =>
      ok(expectedProof),
    );
    container.handleStatementStoreCreateProof(handler);

    const result = await statementStore.createProof(accountId, statement);

    expect(handler).toBeCalledWith([accountId, statement], { ok: expect.any(Function), err: expect.any(Function) });
    expect(result).toEqual(expectedProof);
  });

  it('should submit a signed statement', async () => {
    const { container, statementStore } = setup();
    const signedStatement = createMockSignedStatement(1);

    const permissionHandler = vi.fn<ContainerHandlerOf<typeof container.handlePermission>>((_params, { ok }) =>
      ok(true),
    );
    container.handlePermission(permissionHandler);
    const handler = vi.fn<ContainerHandlerOf<typeof container.handleStatementStoreSubmit>>((_, { ok }) =>
      ok(undefined),
    );
    container.handleStatementStoreSubmit(handler);

    await statementStore.submit(signedStatement);

    expect(handler).toBeCalledWith(signedStatement, { ok: expect.any(Function), err: expect.any(Function) });
    expect(permissionHandler).toHaveBeenCalledOnce();
    const [receivedParams] = permissionHandler.mock.calls[0]!;
    expect(receivedParams).toEqual({ tag: 'StatementSubmit', value: undefined });
  });

  it('should handle createProof error when account is unknown', async () => {
    const { container, statementStore } = setup();
    const accountId = createMockAccountId();
    const statement = createMockStatement(1);
    const error = new StatementProofErr.UnknownAccount();

    container.handleStatementStoreCreateProof((_, { err }) => err(error));

    await expect(statementStore.createProof(accountId, statement)).rejects.toEqual(error);
  });

  it('should handle submit error', async () => {
    const { container, statementStore } = setup();
    const signedStatement = createMockSignedStatement(1);
    const error = new GenericError({ reason: 'Submit failed' });

    const permissionHandler = vi.fn<ContainerHandlerOf<typeof container.handlePermission>>((_params, { ok }) =>
      ok(true),
    );
    container.handlePermission(permissionHandler);
    container.handleStatementStoreSubmit((_, { err }) => err(error));

    await expect(statementStore.submit(signedStatement)).rejects.toEqual(error);

    expect(permissionHandler).toHaveBeenCalledOnce();
    const [receivedParams] = permissionHandler.mock.calls[0]!;
    expect(receivedParams).toEqual({ tag: 'StatementSubmit', value: undefined });
  });

  it('should unsubscribe from statement updates', async () => {
    const { container, statementStore } = setup();
    const filter: StatementTopicFilter = { matchAll: [createTopic(1)] };
    const statement = createMockSignedStatement(1);
    const cleanupFn = vi.fn();

    container.handleStatementStoreSubscribe((_, send) => {
      // Send initial update
      send({ statements: [statement], isComplete: true });
      return cleanupFn;
    });

    const callback = vi.fn();
    const subscription = statementStore.subscribe(filter, callback);

    expect(callback).toHaveBeenCalledTimes(1);

    // Unsubscribe
    subscription.unsubscribe();

    expect(cleanupFn).toHaveBeenCalled();
  });
});
