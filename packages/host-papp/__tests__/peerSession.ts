import { enumValue } from '@novasamatech/scale';
import type { SignedStatement } from '@novasamatech/sdk-statement';
import type { ResponseStatus, StatementStoreAdapter } from '@novasamatech/statement-store';
import {
  createAccountId,
  createEncryption,
  createInMemoryStatementStore,
  createSession,
  createSr25519Prover,
  createSr25519Secret,
} from '@novasamatech/statement-store';
import type { StorageAdapter } from '@novasamatech/storage-adapter';
import { createMemoryAdapter } from '@novasamatech/storage-adapter';
import { errAsync, okAsync } from 'neverthrow';
import { toHex } from 'polkadot-api/utils';
import { EMPTY } from 'rxjs';
import { Bytes } from 'scale-ts';

import type { EncrSecret, SsSecret } from '../src/crypto.js';
import { createIdentityRepository } from '../src/identity/impl.js';
import type { IdentityAdapter, IdentityRepository } from '../src/identity/types.js';
import type { AllowanceRepository } from '../src/sso/allowance/index.js';
import { createAllowanceRepository } from '../src/sso/allowance/index.js';
import { computePairingChannel, computePairingTopic } from '../src/sso/auth/v2/topic.js';
import type { RemoteMessage } from '../src/sso/sessionManager/scale/remoteMessage.js';
import { RemoteMessageCodec } from '../src/sso/sessionManager/scale/remoteMessage.js';
import { createUserSession } from '../src/sso/sessionManager/userSession.js';
import type { StoredUserSession } from '../src/sso/userSessionRepository.js';

type V1 = RemoteMessage['data'] & { tag: 'v1' };

/** Let every already-queued transport task run. */
export const flush = () => new Promise(resolve => setImmediate(resolve));

// `ssSecret` must be a real expanded sr25519 secret — random 32 bytes trap in
// the schnorrkel wasm.
export function makeSecrets(seed: Uint8Array) {
  return {
    ssSecret: createSr25519Secret(seed) as SsSecret,
    encrSecret: seed as EncrSecret,
    identityChatPrivateKey: seed,
  };
}

// Offline / no allowance / unreachable peer.
export function createUnwritableStatementStore(): StatementStoreAdapter {
  return {
    queryStatements: () => okAsync([]),
    subscribeStatements: () => () => undefined,
    submitStatement: () => errAsync(new Error('submit rejected')),
  };
}

// Successive responses to one device share a channel, and the store keeps only
// the highest expiry — so each publish must outrank the last or it is silently
// dropped. Counted per channel rather than left to callers.
const publishedPerChannel = new Map<string, bigint>();

/**
 * Publish what the paired app answers a pairing proposal with, on the topic and
 * channel both sides derive from the device pubkeys in the QR proposal — so a
 * host subscribed to the wrong topic never sees it.
 */
export function publishPairingResponse(
  statementStore: StatementStoreAdapter,
  device: { statementAccountPublicKey: Uint8Array; encryptionPublicKey: Uint8Array },
  data: Uint8Array,
  { signer = `0x${'44'.repeat(32)}` }: { signer?: string } = {},
) {
  const channel = toHex(computePairingChannel(device.statementAccountPublicKey, device.encryptionPublicKey));
  const expiry = (publishedPerChannel.get(channel) ?? 0n) + 1n;
  publishedPerChannel.set(channel, expiry);

  return statementStore.submitStatement({
    data,
    expiry,
    channel,
    topics: [toHex(computePairingTopic(device.statementAccountPublicKey, device.encryptionPublicKey))],
    proof: { type: 'sr25519', value: { signature: `0x${'00'.repeat(64)}`, signer } },
  } as SignedStatement);
}

export function makeStoredUserSession(
  id: string,
  identityAccountId: Uint8Array = new Uint8Array(32).fill(7),
): StoredUserSession {
  const seed = id.charCodeAt(id.length - 1);

  return {
    id,
    localAccount: { accountId: createAccountId(new Uint8Array(32).fill(seed)), pin: undefined },
    // Must differ from the local id: the two derive the outgoing and incoming
    // topics, and equal ids collapse them into one channel.
    remoteAccount: {
      accountId: createAccountId(new Uint8Array(32).fill(seed + 1)),
      publicKey: new Uint8Array(32).fill(seed + 2),
      pin: undefined,
    },
    // Seeded from the id like the accounts above, so a bug that writes one
    // session's blob under another's id shows up as a value mismatch. 32 bytes
    // each: what `StoredUserSessionCodec` persists.
    rootAccountId: createAccountId(new Uint8Array(32).fill(seed)),
    identityAccountId: createAccountId(identityAccountId),
    identityChatPublicKey: new Uint8Array(32).fill(seed),
    ssoEncPubKey: new Uint8Array(32).fill(seed),
    rootEntropySource: new Uint8Array(32).fill(seed),
    deviceEncPubKey: new Uint8Array(32).fill(seed),
  };
}

export const inertIdentityAdapter: IdentityAdapter = {
  readIdentities: () => okAsync({}),
  watchIdentity: () => EMPTY,
};

/**
 * A real `UserSession` and the peer half of it over one in-memory statement
 * store. Nothing between them is doubled: what the peer answers, the wrapper
 * decodes, and what the wrapper sends, the peer receives.
 */
export function createPairedUserSession({
  id = 'user-session-1',
  identityAccountId,
  storage = createMemoryAdapter(),
  statementStore = createInMemoryStatementStore(),
  allowanceRepository,
  identityRepository,
}: {
  id?: string;
  identityAccountId?: Uint8Array;
  storage?: StorageAdapter;
  statementStore?: StatementStoreAdapter;
  allowanceRepository?: AllowanceRepository;
  identityRepository?: IdentityRepository;
} = {}) {
  const userSession = makeStoredUserSession(id, identityAccountId);

  const session = createUserSession({
    userSession,
    statementStore,
    encryption: createEncryption(userSession.remoteAccount.publicKey),
    prover: createSr25519Prover(createSr25519Secret(new Uint8Array(32).fill(5))),
    storage,
    allowanceRepository: allowanceRepository ?? createAllowanceRepository('salt', createMemoryAdapter()),
    identityRepository: identityRepository ?? createIdentityRepository({ adapter: inertIdentityAdapter, storage }),
  });

  return { session, userSession, peer: createPeerSession(statementStore, userSession) };
}

/**
 * The paired mobile app, as a real session over the same statement store: local
 * and remote swapped, so a submit here lands on the topic the host listens on.
 *
 * By default it stays silent — a host request is received but never ACKed or
 * answered. `ackWith` and `answerWith` pick what it does next.
 */
export function createPeerSession(statementStore: StatementStoreAdapter, session: StoredUserSession) {
  const received: RemoteMessage[] = [];
  let ack: ResponseStatus | null = null;
  let answer: ((request: RemoteMessage) => V1['value']) | null = null;

  const peer = createSession({
    localAccount: { accountId: session.remoteAccount.accountId, pin: session.remoteAccount.pin },
    remoteAccount: { ...session.localAccount, publicKey: session.remoteAccount.publicKey },
    statementStore,
    encryption: createEncryption(session.remoteAccount.publicKey),
    // Statements carry their signer in the proof, so any secret proves them.
    prover: createSr25519Prover(createSr25519Secret(new Uint8Array(32).fill(11))),
    sessionKey: session.remoteAccount.publicKey,
  });

  const send = (messageId: string, value: V1['value']) =>
    peer.submitRequestMessage(RemoteMessageCodec, { messageId, data: enumValue('v1', value) });

  // Observe every host request without answering it — silence is the default,
  // because `respondToRequests` cannot express "received but not ACKed".
  peer.subscribe(RemoteMessageCodec, messages => {
    for (const message of messages) {
      if (message.type !== 'request' || message.payload.status !== 'parsed') continue;
      received.push(message.payload.value);
      if (answer) void send(`${message.payload.value.messageId}-reply`, answer(message.payload.value));
    }
  });

  // Registered only once an ACK is asked for; until then the host waits forever.
  let unsubscribeResponder: VoidFunction | undefined;
  const respond = (status: ResponseStatus) => {
    ack = status;
    unsubscribeResponder ??= peer.respondToRequests(RemoteMessageCodec, () => ack ?? 'success');
  };

  return {
    received,
    /** ACK every host request with `status` instead of leaving it hanging. */
    ackWith: respond,
    /**
     * Answer each host request with the built reply. Independent of `ackWith`:
     * the transport ACK and the application reply are separate channels, and a
     * reply must land whether or not the ACK ever does.
     */
    answerWith(build: (request: RemoteMessage) => V1['value']) {
      answer = build;
    },
    /** Send an unprompted message, as the peer does for `Disconnected`. */
    send,
    /** Send one and wait for the host's transport ACK. */
    request: (messageId: string, value: V1['value']) =>
      peer.request(RemoteMessageCodec, { messageId, data: enumValue('v1', value) }),
    /** Bytes that decrypt but do not decode as a RemoteMessage. */
    sendUndecodable: () => peer.request(Bytes(), new Uint8Array([1, 2, 3])),
    dispose: () => peer.dispose(),
  };
}
