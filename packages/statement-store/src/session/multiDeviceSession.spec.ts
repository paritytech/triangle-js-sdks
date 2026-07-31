/**
 * End-to-end multi-device session: two users, each with their own device(s), talking over
 * one shared in-memory statement store. Exercises the wire path the desktop chat client
 * will use — `multiRequest`/`multiResponse` envelopes on device-derived topics.
 */

import { x25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { Bytes } from '@novasamatech/scale';
import { okAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { createInMemoryStatementStore } from '../adapter/inMemory.js';
import { createAccountId } from '../model/sessionAccount.js';
import { createExpiryAllocator } from '../submit/allocator.js';

import type { DeviceTarget } from './codec/envelope.js';
import type { PeerRoster } from './codec/incomingTopics.js';
import { createMultiDeviceSession } from './session.js';
import type { StatementProver } from './statementProver.js';

const rawCodec = Bytes();

// Proof verification is exercised in statementProver tests; here a stub keeps statements
// well-formed without pulling in real sr25519 signing.
const mockProver: StatementProver = {
  generateMessageProof: statement =>
    okAsync({
      ...statement,
      proof: { type: 'sr25519', value: { signature: `0x${'00'.repeat(64)}`, signer: `0x${'00'.repeat(32)}` } },
    }),
  verifyMessageProof: () => okAsync(true),
};

const delay = () => new Promise(resolve => setTimeout(resolve, 0));

function createDevice() {
  const encryptionPrivateKey = x25519.utils.randomSecretKey();

  return {
    statementAccountId: randomBytes(32),
    encryptionPrivateKey,
    encryptionPublicKey: x25519.getPublicKey(encryptionPrivateKey),
  };
}

function createIdentity() {
  const chatPrivateKey = x25519.utils.randomSecretKey();

  return {
    accountId: createAccountId(randomBytes(32)),
    chatPrivateKey,
    chatPublicKey: x25519.getPublicKey(chatPrivateKey),
  };
}

/** A roster whose contents can be swapped at runtime, like a peer adding a device. */
function mutableRoster(initial: DeviceTarget[]) {
  let devices = initial;
  const listeners = new Set<(devices: DeviceTarget[]) => void>();

  const roster: PeerRoster = {
    current: () => devices,
    subscribe(callback) {
      listeners.add(callback);

      return () => listeners.delete(callback);
    },
  };

  return {
    roster,
    set(next: DeviceTarget[]) {
      devices = next;
      for (const listener of listeners) listener(next);
    },
  };
}

const toTarget = (device: ReturnType<typeof createDevice>): DeviceTarget => ({
  statementAccountId: device.statementAccountId,
  encryptionPublicKey: device.encryptionPublicKey,
});

describe('multi-device session', () => {
  it('completes a request → ACK round trip between two users', async () => {
    const store = createInMemoryStatementStore();
    const alice = createIdentity();
    const bob = createIdentity();
    const aliceDevice = createDevice();
    const bobDevice = createDevice();

    const aliceSession = createMultiDeviceSession({
      localDevice: aliceDevice,
      localIdentity: alice,
      remoteIdentity: { accountId: bob.accountId, chatPublicKey: bob.chatPublicKey },
      peerRoster: mutableRoster([toTarget(bobDevice)]).roster,
      statementStore: store,
      prover: mockProver,
      allocator: createExpiryAllocator(),
    });

    const bobSession = createMultiDeviceSession({
      localDevice: bobDevice,
      localIdentity: bob,
      remoteIdentity: { accountId: alice.accountId, chatPublicKey: alice.chatPublicKey },
      peerRoster: mutableRoster([toTarget(aliceDevice)]).roster,
      statementStore: store,
      prover: mockProver,
      allocator: createExpiryAllocator(),
    });

    await delay();

    // Bob answers whatever Alice sends, which is what resolves her delivery promise.
    const received: Uint8Array[] = [];
    bobSession.respondToRequests(rawCodec, request => {
      if (request.payload.status === 'parsed') received.push(request.payload.value);

      return 'success';
    });
    // A session only opens its store subscription once something subscribes, so a caller
    // awaiting `request()` must also be subscribed or the peer's ACK never arrives.
    aliceSession.subscribe(rawCodec, vi.fn());

    const payload = new TextEncoder().encode('hello bob');
    await expect(aliceSession.request(rawCodec, payload)).toBeOk();

    expect(received).toEqual([payload]);

    aliceSession.dispose();
    bobSession.dispose();
  });

  // A device inherits the pin of the identity it belongs to. If the sender and receiver
  // disagree about which pin goes in the SessionIdParam, they derive different topics and
  // messages silently never arrive — so exercise a round trip with pins set on both sides.
  it('agrees on topics when both identities carry a pin', async () => {
    const store = createInMemoryStatementStore();
    const alice = createIdentity();
    const bob = createIdentity();
    const aliceDevice = createDevice();
    const bobDevice = createDevice();
    const alicePin = 'alice-pin';
    const bobPin = 'bob-pin';

    const aliceSession = createMultiDeviceSession({
      localDevice: aliceDevice,
      localIdentity: { ...alice, pin: alicePin },
      remoteIdentity: { accountId: bob.accountId, chatPublicKey: bob.chatPublicKey, pin: bobPin },
      peerRoster: mutableRoster([toTarget(bobDevice)]).roster,
      statementStore: store,
      prover: mockProver,
      allocator: createExpiryAllocator(),
    });

    const bobSession = createMultiDeviceSession({
      localDevice: bobDevice,
      localIdentity: { ...bob, pin: bobPin },
      remoteIdentity: { accountId: alice.accountId, chatPublicKey: alice.chatPublicKey, pin: alicePin },
      peerRoster: mutableRoster([toTarget(aliceDevice)]).roster,
      statementStore: store,
      prover: mockProver,
      allocator: createExpiryAllocator(),
    });

    await delay();

    const seen: Uint8Array[] = [];
    bobSession.subscribe(rawCodec, messages => {
      for (const message of messages) {
        if (message.type === 'request' && message.payload.status === 'parsed') seen.push(message.payload.value);
      }
    });

    const payload = new TextEncoder().encode('pinned hello');
    await expect(aliceSession.submitRequestMessage(rawCodec, payload)).toBeOk();
    await delay();

    expect(seen).toEqual([payload]);

    aliceSession.dispose();
    bobSession.dispose();
  });

  it('reaches every device of a multi-device peer', async () => {
    const store = createInMemoryStatementStore();
    const alice = createIdentity();
    const bob = createIdentity();
    const aliceDevice = createDevice();
    const bobLaptop = createDevice();
    const bobPhone = createDevice();

    const aliceSession = createMultiDeviceSession({
      localDevice: aliceDevice,
      localIdentity: alice,
      remoteIdentity: { accountId: bob.accountId, chatPublicKey: bob.chatPublicKey },
      peerRoster: mutableRoster([toTarget(bobLaptop), toTarget(bobPhone)]).roster,
      statementStore: store,
      prover: mockProver,
      allocator: createExpiryAllocator(),
    });

    // Both of Bob's devices run their own session against the same identity.
    const bobSessions = [bobLaptop, bobPhone].map(device =>
      createMultiDeviceSession({
        localDevice: device,
        localIdentity: bob,
        remoteIdentity: { accountId: alice.accountId, chatPublicKey: alice.chatPublicKey },
        peerRoster: mutableRoster([toTarget(aliceDevice)]).roster,
        statementStore: store,
        prover: mockProver,
        allocator: createExpiryAllocator(),
      }),
    );

    await delay();

    const seen = bobSessions.map(() => [] as Uint8Array[]);
    bobSessions.forEach((session, index) => {
      session.subscribe(rawCodec, messages => {
        for (const message of messages) {
          if (message.type === 'request' && message.payload.status === 'parsed') {
            seen[index]!.push(message.payload.value);
          }
        }
      });
    });

    const payload = new TextEncoder().encode('hello both devices');
    await expect(aliceSession.submitRequestMessage(rawCodec, payload)).toBeOk();
    await delay();

    // One statement, one envelope — decrypted independently by each recipient device.
    expect(seen[0]).toEqual([payload]);
    expect(seen[1]).toEqual([payload]);

    aliceSession.dispose();
    for (const session of bobSessions) session.dispose();
  });

  it('addresses a device the peer adds mid-session', async () => {
    const store = createInMemoryStatementStore();
    const alice = createIdentity();
    const bob = createIdentity();
    const aliceDevice = createDevice();
    const bobLaptop = createDevice();
    const bobPhone = createDevice();

    const bobRoster = mutableRoster([toTarget(bobLaptop)]);
    const aliceSession = createMultiDeviceSession({
      localDevice: aliceDevice,
      localIdentity: alice,
      remoteIdentity: { accountId: bob.accountId, chatPublicKey: bob.chatPublicKey },
      peerRoster: bobRoster.roster,
      statementStore: store,
      prover: mockProver,
      allocator: createExpiryAllocator(),
    });
    await delay();

    // The new device comes online and Alice learns about it (deviceAdded, in production).
    bobRoster.set([toTarget(bobLaptop), toTarget(bobPhone)]);

    const phoneSession = createMultiDeviceSession({
      localDevice: bobPhone,
      localIdentity: bob,
      remoteIdentity: { accountId: alice.accountId, chatPublicKey: alice.chatPublicKey },
      peerRoster: mutableRoster([toTarget(aliceDevice)]).roster,
      statementStore: store,
      prover: mockProver,
      allocator: createExpiryAllocator(),
    });
    await delay();

    const seen: Uint8Array[] = [];
    phoneSession.subscribe(rawCodec, messages => {
      for (const message of messages) {
        if (message.type === 'request' && message.payload.status === 'parsed') seen.push(message.payload.value);
      }
    });

    const payload = new TextEncoder().encode('now includes the phone');
    await expect(aliceSession.submitRequestMessage(rawCodec, payload)).toBeOk();
    await delay();

    expect(seen).toEqual([payload]);

    aliceSession.dispose();
    phoneSession.dispose();
  });

  it('opens ONE subscription regardless of how many devices the peer has', async () => {
    const store = createInMemoryStatementStore();
    const alice = createIdentity();
    const bob = createIdentity();
    const peerDevices = [createDevice(), createDevice(), createDevice()].map(toTarget);

    const session = createMultiDeviceSession({
      localDevice: createDevice(),
      localIdentity: alice,
      remoteIdentity: { accountId: bob.accountId, chatPublicKey: bob.chatPublicKey },
      peerRoster: mutableRoster(peerDevices).roster,
      statementStore: store,
      prover: mockProver,
      allocator: createExpiryAllocator(),
    });
    await delay();

    session.subscribe(rawCodec, vi.fn());

    expect(store.activeSubscriptions()).toBe(1);

    session.dispose();
  });

  // The initialization-phase read-back that removes the need for a client-side outbox:
  // a fresh session recovers its unacknowledged batch from the store alone.
  it('restores its unacknowledged outgoing batch from the store after a restart', async () => {
    const store = createInMemoryStatementStore();
    const alice = createIdentity();
    const bob = createIdentity();
    const aliceDevice = createDevice();
    const bobDevice = createDevice();
    const allocator = createExpiryAllocator();

    const params = {
      localDevice: aliceDevice,
      localIdentity: alice,
      remoteIdentity: { accountId: bob.accountId, chatPublicKey: bob.chatPublicKey },
      peerRoster: mutableRoster([toTarget(bobDevice)]).roster,
      statementStore: store,
      prover: mockProver,
      allocator,
    };

    const first = createMultiDeviceSession(params);
    await delay();
    const payload = new TextEncoder().encode('unacked message');
    await expect(first.submitRequestMessage(rawCodec, payload)).toBeOk();
    await delay();
    first.dispose(); // Bob never answered.

    // A brand-new session over the same store must recover the pending batch, so the next
    // message extends it rather than silently dropping the earlier one.
    const restored = createMultiDeviceSession(params);
    await delay();

    const bobSeen: Uint8Array[] = [];
    const bobSession = createMultiDeviceSession({
      localDevice: bobDevice,
      localIdentity: bob,
      remoteIdentity: { accountId: alice.accountId, chatPublicKey: alice.chatPublicKey },
      peerRoster: mutableRoster([toTarget(aliceDevice)]).roster,
      statementStore: store,
      prover: mockProver,
      allocator: createExpiryAllocator(),
    });
    bobSession.subscribe(rawCodec, messages => {
      for (const message of messages) {
        if (message.type === 'request' && message.payload.status === 'parsed') bobSeen.push(message.payload.value);
      }
    });
    await delay();

    const second = new TextEncoder().encode('second message');
    await expect(restored.submitRequestMessage(rawCodec, second)).toBeOk();
    await delay();

    // The replacing statement carries BOTH messages, so a peer that only ever sees the
    // surviving statement still gets the un-acked one. (Bob also saw the pre-replacement
    // statement during his own init, hence the trailing-pair assertion — de-duplicating by
    // message id is the application layer's job, not the transport's.)
    expect(bobSeen.slice(-2)).toEqual([payload, second]);

    restored.dispose();
    bobSession.dispose();
  });
});
