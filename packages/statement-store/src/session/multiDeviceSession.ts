/**
 * Multi-device session (mds.md §"Sending P2P Messages"): one statement addressed to every
 * device a peer runs, and one subscription covering every device they publish from.
 *
 * See `session.ts` for the single-device variant, and `core.ts` for the shared driver.
 */

import { x25519 } from '@noble/curves/ed25519.js';

import type { StatementStoreAdapter } from '../adapter/types.js';
import { createSessionId } from '../model/session.js';
import type { AccountId, SessionAccount } from '../model/sessionAccount.js';
import { createAccountId } from '../model/sessionAccount.js';
import type { ExpiryAllocator } from '../submit/allocator.js';
import { createExpiryAllocator } from '../submit/allocator.js';

import { createStatementDecoder } from './codec/decoder.js';
import { createEnvelope } from './codec/envelope.js';
import type { PeerRoster } from './codec/incomingTopics.js';
import { createRosterTopics } from './codec/incomingTopics.js';
import { createBodyBuilder } from './codec/outgoingBody.js';
import { DEFAULT_MAX_REQUEST_SIZE, createSessionCore } from './core.js';
import { createEncryption } from './encyption.js';
import type { StatementProver } from './statementProver.js';
import type { Session } from './types.js';

export type MultiDeviceSessionParams = {
  /** This device: statement account (proof signer identity) and its X25519 encryption key. */
  localDevice: {
    statementAccountId: Uint8Array;
    encryptionPrivateKey: Uint8Array;
  };
  /** This user's identity: account id and the identity chat key shared across own devices. */
  localIdentity: {
    accountId: AccountId;
    chatPrivateKey: Uint8Array;
    pin?: string;
  };
  /** The peer user's identity. */
  remoteIdentity: {
    accountId: AccountId;
    chatPublicKey: Uint8Array;
    pin?: string;
  };
  /** The peer's devices — observable, since `deviceAdded`/`deviceRemoved` change it at runtime. */
  peerRoster: PeerRoster;
  statementStore: StatementStoreAdapter;
  prover: StatementProver;
  allocator?: ExpiryAllocator;
  maxRequestSize?: number;
};

/**
 * Multi-device session (mds.md §"Sending P2P Messages").
 *
 * Outgoing: `topic = SessionId(D(A), B)` keyed by `x25519(ownDeviceEncPriv,
 * peerIdentityChatPub)`, carrying a `multiRequest`/`multiResponse` envelope wrapped for
 * every known peer device.
 *
 * Incoming: one topic per peer device, `SessionId(D(B'), A)` keyed by
 * `x25519(ownIdentityChatPriv, D(B').encPub)` — covered by a single `matchAny`
 * subscription that re-opens when the roster changes.
 */
export function createMultiDeviceSession({
  localDevice,
  localIdentity,
  remoteIdentity,
  peerRoster,
  statementStore,
  prover,
  allocator = createExpiryAllocator(),
  maxRequestSize = DEFAULT_MAX_REQUEST_SIZE,
}: MultiDeviceSessionParams): Session {
  const outgoingSharedSecret = x25519.getSharedSecret(localDevice.encryptionPrivateKey, remoteIdentity.chatPublicKey);
  const outgoingEncryption = createEncryption(outgoingSharedSecret);

  const localDeviceAccount: SessionAccount = {
    accountId: createAccountId(localDevice.statementAccountId),
    pin: localIdentity.pin,
  };
  const remoteIdentityAccount: SessionAccount = { accountId: remoteIdentity.accountId, pin: remoteIdentity.pin };
  const localIdentityAccount: SessionAccount = { accountId: localIdentity.accountId, pin: localIdentity.pin };

  const outgoingTopic = createSessionId(outgoingSharedSecret, localDeviceAccount, remoteIdentityAccount);

  const envelope = createEnvelope({
    ownStatementAccountId: localDevice.statementAccountId,
    ownEncryptionPrivateKey: localDevice.encryptionPrivateKey,
  });

  return createSessionCore({
    statementStore,
    prover,
    allocator,
    maxRequestSize,
    outgoingTopic,
    bodyBuilder: createBodyBuilder({
      topic: outgoingTopic,
      encryption: outgoingEncryption,
      multiDevice: { envelope, recipients: () => peerRoster.current() },
    }),
    incomingTopics: createRosterTopics({
      localIdentity: localIdentityAccount,
      remotePin: remoteIdentity.pin,
      ownIdentityChatPrivateKey: localIdentity.chatPrivateKey,
      peerRoster,
    }),
    decoder: createStatementDecoder({ prover, envelope, ownEncryption: outgoingEncryption }),
    peerDevices: () => peerRoster.current(),
  });
}
