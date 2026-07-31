/**
 * The set of topics a session listens on, and the keys needed to read each one.
 *
 * Single-device sessions listen on exactly one topic — `SessionId(B, A)`, keyed by the
 * pairwise shared secret. Multi-device sessions listen on one topic PER PEER DEVICE:
 * `SessionId(D(B'), A)` keyed by `x25519(ownIdentityChatPriv, D(B').encPub)`, the
 * receive-side mirror of the sender's `SessionId(D(A), B)` (mds.md).
 *
 * The set is observable because a peer's device roster changes at runtime
 * (`deviceAdded`/`deviceRemoved`). The driver opens ONE `matchAny` subscription over the
 * whole set and re-opens it when the set changes — rather than one subscription per
 * device, which grows as contacts × devices.
 */

import { x25519 } from '@noble/curves/ed25519.js';

import { createSessionId } from '../../model/session.js';
import type { SessionAccount } from '../../model/sessionAccount.js';
import { createEncryption } from '../encyption.js';

import type { IncomingTopicSpec } from './decoder.js';
import type { DeviceTarget } from './envelope.js';

export type PeerRoster = {
  current(): DeviceTarget[];
  subscribe(callback: (devices: DeviceTarget[]) => void): VoidFunction;
};

export type IncomingTopics = {
  current(): IncomingTopicSpec[];
  /** Fires when the topic set changes. Returns an unsubscribe handle. */
  subscribe(callback: (specs: IncomingTopicSpec[]) => void): VoidFunction;
};

/** One fixed topic — the single-device case. */
export function createStaticTopics(spec: IncomingTopicSpec): IncomingTopics {
  const specs = [spec];

  return {
    current: () => specs,
    subscribe: () => () => undefined,
  };
}

/**
 * One topic per peer device, recomputed whenever the roster changes.
 *
 * Derivation per device `D(B')`:
 *   K       = x25519(ownIdentityChatPrivateKey, D(B').encryptionPublicKey)
 *   topic   = SessionId(D(B'), A)  — sender is the peer device, receiver is our identity
 */
export function createRosterTopics({
  localIdentity,
  remotePin,
  ownIdentityChatPrivateKey,
  peerRoster,
}: {
  localIdentity: SessionAccount;
  /**
   * The peer IDENTITY's pin. A device inherits the pin of the identity it belongs to, so
   * this is what goes in the sender slot of `SessionIdParam` — matching what the peer used
   * when it published (Android `RealIncomingTopicsProviderFactory`, `pin = remoteAccount.pin`).
   * Getting this wrong yields a topic the peer never writes to, and messages simply never arrive.
   */
  remotePin: string | undefined;
  ownIdentityChatPrivateKey: Uint8Array;
  peerRoster: PeerRoster;
}): IncomingTopics {
  function toSpecs(devices: DeviceTarget[]): IncomingTopicSpec[] {
    return devices.flatMap(device => {
      let sharedSecret: Uint8Array;
      try {
        // Throws on a small-order peer key (RFC 7748); a malformed roster entry must not
        // take down the whole topic set, so it is skipped instead.
        sharedSecret = x25519.getSharedSecret(ownIdentityChatPrivateKey, device.encryptionPublicKey);
      } catch {
        return [];
      }

      const remoteDevice: SessionAccount = { accountId: device.statementAccountId as never, pin: remotePin };

      return [
        {
          topic: createSessionId(sharedSecret, remoteDevice, localIdentity),
          senderEncryptionPublicKey: device.encryptionPublicKey,
          encryption: createEncryption(sharedSecret),
        },
      ];
    });
  }

  let specs = toSpecs(peerRoster.current());

  return {
    current: () => specs,
    subscribe(callback) {
      return peerRoster.subscribe(devices => {
        specs = toSpecs(devices);
        callback(specs);
      });
    },
  };
}
