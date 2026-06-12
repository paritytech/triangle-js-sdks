import { createMemoryAdapter } from '@novasamatech/storage-adapter';
import { describe, expect, it } from 'vitest';

import { createAllowanceRepository } from '../src/sso/allowance/repository.js';

const KEY_A = new Uint8Array([1, 2, 3, 4, 5]);
const KEY_B = new Uint8Array([6, 7, 8, 9, 10]);

describe('createAllowanceRepository', () => {
  it('returns null when no entry has been written', async () => {
    const repo = createAllowanceRepository('salt', createMemoryAdapter());

    const result = await repo.read('session-1', 'product.dot', 'bulletin');

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });

  it('round-trips an encrypted slot account key', async () => {
    const repo = createAllowanceRepository('salt', createMemoryAdapter());

    await repo.write('session-1', 'product.dot', 'bulletin', KEY_A);
    const result = await repo.read('session-1', 'product.dot', 'bulletin');

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(KEY_A);
  });

  it('isolates entries by sessionId, productId, and resource', async () => {
    const repo = createAllowanceRepository('salt', createMemoryAdapter());

    await repo.write('session-1', 'product.dot', 'bulletin', KEY_A);
    await repo.write('session-1', 'product.dot', 'statementStore', KEY_B);

    expect((await repo.read('session-1', 'product.dot', 'bulletin'))._unsafeUnwrap()).toEqual(KEY_A);
    expect((await repo.read('session-1', 'product.dot', 'statementStore'))._unsafeUnwrap()).toEqual(KEY_B);
    expect((await repo.read('session-2', 'product.dot', 'bulletin'))._unsafeUnwrap()).toBeNull();
    expect((await repo.read('session-1', 'other.dot', 'bulletin'))._unsafeUnwrap()).toBeNull();
  });

  it('overwrites existing entry for same (session, product, resource)', async () => {
    const repo = createAllowanceRepository('salt', createMemoryAdapter());

    await repo.write('session-1', 'product.dot', 'bulletin', KEY_A);
    await repo.write('session-1', 'product.dot', 'bulletin', KEY_B);

    expect((await repo.read('session-1', 'product.dot', 'bulletin'))._unsafeUnwrap()).toEqual(KEY_B);
  });

  it('clears all entries for a session', async () => {
    const repo = createAllowanceRepository('salt', createMemoryAdapter());

    await repo.write('session-1', 'product.dot', 'bulletin', KEY_A);
    await repo.write('session-1', 'product.dot', 'statementStore', KEY_B);
    await repo.write('session-2', 'product.dot', 'bulletin', KEY_A);

    await repo.clearSession('session-1');

    expect((await repo.read('session-1', 'product.dot', 'bulletin'))._unsafeUnwrap()).toBeNull();
    expect((await repo.read('session-1', 'product.dot', 'statementStore'))._unsafeUnwrap()).toBeNull();
    // sibling session untouched
    expect((await repo.read('session-2', 'product.dot', 'bulletin'))._unsafeUnwrap()).toEqual(KEY_A);
  });

  it('does not decrypt when salt differs', async () => {
    const storage = createMemoryAdapter();
    const writer = createAllowanceRepository('salt-a', storage);
    const reader = createAllowanceRepository('salt-b', storage);

    await writer.write('session-1', 'product.dot', 'bulletin', KEY_A);

    const result = await reader.read('session-1', 'product.dot', 'bulletin');

    expect(result.isErr()).toBe(true);
  });
});
