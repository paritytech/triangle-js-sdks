import { GenericError, StatementProofErr, createTransport, enumValue } from '@novasamatech/host-api';
import { createContainer } from '@novasamatech/host-container';
import type { ProductAccountId, SignedStatement, Statement, Topic } from '@novasamatech/product-sdk';
import { createStatementStore } from '@novasamatech/product-sdk';

import { describe, expect, it, vi } from 'vitest';

import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

function delay(ttl: number) {
  return new Promise(resolve => setTimeout(resolve, ttl));
}

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
    priority: undefined,
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
    priority: undefined,
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
  it('should query statements by topics', async () => {
    const { container, statementStore } = setup();
    const topics = [createTopic(1), createTopic(2)];
    const expectedStatements = [createMockSignedStatement(1), createMockSignedStatement(2)];

    const handler = vi.fn<Parameters<typeof container.handleStatementStoreQuery>[0]>((_, { ok }) =>
      ok(expectedStatements),
    );
    container.handleStatementStoreQuery(handler);

    const result = await statementStore.query(topics);

    expect(handler).toBeCalledWith(topics, { ok: expect.any(Function), err: expect.any(Function) });
    expect(result).toEqual(expectedStatements);
  });

  it('should subscribe to statement updates', async () => {
    const { container, statementStore } = setup();
    const topics = [createTopic(1)];
    const statement1 = createMockSignedStatement(1);
    const statement2 = createMockSignedStatement(2);

    container.handleStatementStoreSubscribe((params, send) => {
      expect(params).toEqual(topics);
      // Simulate sending updates
      send([statement1, statement2]);
      return () => {
        /* cleanup */
      };
    });

    const callback = vi.fn();
    statementStore.subscribe(topics, callback);

    // Wait for async message passing
    await delay(10);

    expect(callback).toHaveBeenNthCalledWith(1, [statement1, statement2]);
  });

  it('should create proof for a statement', async () => {
    const { container, statementStore } = setup();
    const accountId = createMockAccountId();
    const statement = createMockStatement(1);
    const expectedProof = enumValue('Sr25519', {
      signature: new Uint8Array(64).fill(5),
      signer: new Uint8Array(32).fill(6),
    });

    const handler = vi.fn<Parameters<typeof container.handleStatementStoreCreateProof>[0]>((_, { ok }) =>
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

    const handler = vi.fn<Parameters<typeof container.handleStatementStoreSubmit>[0]>((_, { ok }) => ok(undefined));
    container.handleStatementStoreSubmit(handler);

    await statementStore.submit(signedStatement);

    expect(handler).toBeCalledWith(signedStatement, { ok: expect.any(Function), err: expect.any(Function) });
  });

  it('should handle query error', async () => {
    const { container, statementStore } = setup();
    const topics = [createTopic(1)];
    const error = new GenericError({ reason: 'Query failed' });

    container.handleStatementStoreQuery((_, { err }) => err(error));

    await expect(statementStore.query(topics)).rejects.toEqual(error);
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

    container.handleStatementStoreSubmit((_, { err }) => err(error));

    await expect(statementStore.submit(signedStatement)).rejects.toEqual(error);
  });

  it('should unsubscribe from statement updates', async () => {
    const { container, statementStore } = setup();
    const topics = [createTopic(1)];
    const statement = createMockSignedStatement(1);
    const cleanupFn = vi.fn();

    container.handleStatementStoreSubscribe((_, send) => {
      // Send initial update
      send([statement]);
      return cleanupFn;
    });

    const callback = vi.fn();
    const subscription = statementStore.subscribe(topics, callback);

    // Wait for async message passing
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(callback).toHaveBeenCalledTimes(1);

    // Unsubscribe
    subscription.unsubscribe();

    // Wait a bit and verify cleanup was called
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(cleanupFn).toHaveBeenCalled();
  });
});
