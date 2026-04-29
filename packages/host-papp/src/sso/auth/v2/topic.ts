/**
 * Pairing topic + channel derivation for the V2 SSO handshake.
 *
 *   topic   = blake2b256_keyed(encryptionPublicKey || "topic",   key=statementAccountId)
 *   channel = blake2b256_keyed(encryptionPublicKey || "channel", key=statementAccountId)
 *
 * Where:
 *   - `statementAccountId`     = the host's sr25519 device public key (32 bytes)
 *   - `encryptionPublicKey`    = the host's P-256 device public key (65 bytes uncompressed)
 *
 * Both sides compute the same topic/channel deterministically from the same
 * pubkeys carried in the QR-coded `VersionedHandshakeProposal::V2`, so they
 * agree on where the response statement is delivered without any shared
 * secret negotiation.
 */

import { khash } from '@novasamatech/statement-store';
import { mergeUint8 } from '@polkadot-api/utils';

const TOPIC_SUFFIX = new TextEncoder().encode('topic');
const CHANNEL_SUFFIX = new TextEncoder().encode('channel');

export const computePairingTopic = (statementAccountId: Uint8Array, encryptionPublicKey: Uint8Array): Uint8Array =>
  khash(statementAccountId, mergeUint8([encryptionPublicKey, TOPIC_SUFFIX]));

export const computePairingChannel = (statementAccountId: Uint8Array, encryptionPublicKey: Uint8Array): Uint8Array =>
  khash(statementAccountId, mergeUint8([encryptionPublicKey, CHANNEL_SUFFIX]));
