import { x25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from '@noble/hashes/utils.js';
import type { Statement } from '@novasamatech/sdk-statement';
import { ok, okAsync } from 'neverthrow';
import { mergeUint8 } from 'polkadot-api/utils';
import { compact, str } from 'scale-ts';
import { describe, expect, it } from 'vitest';

import type { Encryption } from '../encyption.js';
import { Request, Response, StatementData } from '../scale/statementData.js';
import type { StatementProver } from '../statementProver.js';

import type { IncomingTopicSpec } from './decoder.js';
import { createStatementDecoder } from './decoder.js';
import type { DeviceTarget } from './envelope.js';
import { createEnvelope } from './envelope.js';

const acceptingProver: StatementProver = {
  generateMessageProof: statement => okAsync({ ...statement, proof: undefined as never }),
  verifyMessageProof: () => okAsync(true),
};

const rejectingProver: StatementProver = { ...acceptingProver, verifyMessageProof: () => okAsync(false) };

/** Identity encryption keeps the tests focused on decode paths, not on AEAD. */
function passthroughEncryption(): Encryption {
  return { encrypt: data => ok(data), decrypt: data => ok(data) };
}

function createDevice() {
  const encryptionPrivateKey = x25519.utils.randomSecretKey();

  return {
    statementAccountId: randomBytes(32),
    encryptionPublicKey: x25519.getPublicKey(encryptionPrivateKey),
    encryptionPrivateKey,
  };
}

function envelopeFor(device: ReturnType<typeof createDevice>) {
  return createEnvelope({
    ownStatementAccountId: device.statementAccountId,
    ownEncryptionPrivateKey: device.encryptionPrivateKey,
  });
}

function statementWith(data: Uint8Array): Statement {
  return { expiry: 42n, data, topics: [], channel: `0x${'00'.repeat(32)}` };
}

function specFor(senderEncryptionPublicKey: Uint8Array): IncomingTopicSpec {
  return { topic: new Uint8Array(32), senderEncryptionPublicKey, encryption: passthroughEncryption() };
}

const MESSAGES = [new TextEncoder().encode('hello'), new TextEncoder().encode('world')];

function singleDeviceDecoder(prover: StatementProver = acceptingProver) {
  // No envelope — a single-device session cannot open multi-device variants.
  return createStatementDecoder({ prover, ownEncryption: passthroughEncryption() });
}

describe('statement decoder', () => {
  it('decodes a single-device request', async () => {
    const data = StatementData.enc({ tag: 'request', value: { requestId: 'r1', data: MESSAGES } });

    const event = (
      await singleDeviceDecoder().decodePeer(statementWith(data), specFor(randomBytes(32)))
    )._unsafeUnwrap();

    expect(event).toEqual({ tag: 'request', requestId: 'r1', messages: MESSAGES, expiry: 42n });
  });

  it('decodes a single-device response', async () => {
    const data = StatementData.enc({ tag: 'response', value: { requestId: 'r1', responseCode: 'success' } });

    const event = (
      await singleDeviceDecoder().decodePeer(statementWith(data), specFor(randomBytes(32)))
    )._unsafeUnwrap();

    expect(event).toEqual({ tag: 'response', requestId: 'r1', responseCode: 'success', expiry: 42n });
  });

  it('decodes a peer multiRequest addressed to this device', async () => {
    const sender = createDevice();
    const own = createDevice();

    const inner = Request.enc({ requestId: 'r2', data: MESSAGES });
    const wrapped = envelopeFor(sender).wrap(inner, [own])._unsafeUnwrap();
    const data = StatementData.enc({
      tag: 'multiRequest',
      value: { encryptedRequest: wrapped.encryptedPayload, devicesInfo: wrapped.devicesInfo },
    });

    const decoder = createStatementDecoder({
      prover: acceptingProver,
      envelope: envelopeFor(own),
      ownEncryption: passthroughEncryption(),
    });

    const event = (await decoder.decodePeer(statementWith(data), specFor(sender.encryptionPublicKey)))._unsafeUnwrap();

    expect(event).toEqual({ tag: 'request', requestId: 'r2', messages: MESSAGES, expiry: 42n });
  });

  it('decodes a peer multiResponse addressed to this device', async () => {
    const sender = createDevice();
    const own = createDevice();

    const inner = Response.enc({ requestId: 'r3', responseCode: 'success' });
    const wrapped = envelopeFor(sender).wrap(inner, [own])._unsafeUnwrap();
    const data = StatementData.enc({
      tag: 'multiResponse',
      value: { encryptedResponse: wrapped.encryptedPayload, devicesInfo: wrapped.devicesInfo },
    });

    const decoder = createStatementDecoder({
      prover: acceptingProver,
      envelope: envelopeFor(own),
      ownEncryption: passthroughEncryption(),
    });

    const event = (await decoder.decodePeer(statementWith(data), specFor(sender.encryptionPublicKey)))._unsafeUnwrap();

    expect(event).toEqual({ tag: 'response', requestId: 'r3', responseCode: 'success', expiry: 42n });
  });

  // The initialization-phase read-back that replaces a client-side outbox: our own
  // envelope has no entry for us, so it is opened via a recipient device instead.
  it('decodes our OWN multiRequest read back from the store', async () => {
    const own = createDevice();
    const peerA = createDevice();
    const peerB = createDevice();
    const peers: DeviceTarget[] = [peerA, peerB];

    const inner = Request.enc({ requestId: 'own-1', data: MESSAGES });
    const wrapped = envelopeFor(own).wrap(inner, peers)._unsafeUnwrap();
    const data = StatementData.enc({
      tag: 'multiRequest',
      value: { encryptedRequest: wrapped.encryptedPayload, devicesInfo: wrapped.devicesInfo },
    });

    const decoder = createStatementDecoder({
      prover: acceptingProver,
      envelope: envelopeFor(own),
      ownEncryption: passthroughEncryption(),
    });

    const event = (await decoder.decodeOwn(statementWith(data), peers))._unsafeUnwrap();

    expect(event).toEqual({ tag: 'request', requestId: 'own-1', messages: MESSAGES, expiry: 42n });
  });

  it('reports an unopenable envelope as undecodable with no requestId', async () => {
    const sender = createDevice();
    const intended = createDevice();
    const outsider = createDevice();

    const inner = Request.enc({ requestId: 'r4', data: MESSAGES });
    const wrapped = envelopeFor(sender).wrap(inner, [intended])._unsafeUnwrap();
    const data = StatementData.enc({
      tag: 'multiRequest',
      value: { encryptedRequest: wrapped.encryptedPayload, devicesInfo: wrapped.devicesInfo },
    });

    const decoder = createStatementDecoder({
      prover: acceptingProver,
      envelope: envelopeFor(outsider),
      ownEncryption: passthroughEncryption(),
    });

    const event = (await decoder.decodePeer(statementWith(data), specFor(sender.encryptionPublicKey)))._unsafeUnwrap();

    expect(event).toEqual({ tag: 'undecodable', requestId: null });
  });

  // Decrypted but malformed: the requestId survives right after the enum tag, so the
  // sender can still be NACKed rather than left waiting.
  it('recovers the requestId from a decrypted-but-malformed request', async () => {
    // tag(request) : requestId : a message-vector length that no bytes back up.
    const malformed = mergeUint8([new Uint8Array([0]), str.enc('recover-me'), compact.enc(255)]);

    const event = (
      await singleDeviceDecoder().decodePeer(statementWith(malformed), specFor(randomBytes(32)))
    )._unsafeUnwrap();

    expect(event).toEqual({ tag: 'undecodable', requestId: 'recover-me' });
  });

  it('reports garbage with no recoverable requestId as undecodable', async () => {
    const event = (
      await singleDeviceDecoder().decodePeer(statementWith(new Uint8Array([9, 9, 9])), specFor(randomBytes(32)))
    )._unsafeUnwrap();

    expect(event).toEqual({ tag: 'undecodable', requestId: null });
  });

  it('fails a statement whose proof does not verify', async () => {
    const data = StatementData.enc({ tag: 'request', value: { requestId: 'r5', data: MESSAGES } });

    const result = await singleDeviceDecoder(rejectingProver).decodePeer(statementWith(data), specFor(randomBytes(32)));

    expect(result.isErr()).toBe(true);
  });

  it('fails a statement carrying no data', async () => {
    const result = await singleDeviceDecoder().decodePeer({ expiry: 1n, topics: [] }, specFor(randomBytes(32)));

    expect(result.isErr()).toBe(true);
  });

  it('a single-device session cannot open multi-device variants', async () => {
    const sender = createDevice();
    const own = createDevice();

    const inner = Request.enc({ requestId: 'r6', data: MESSAGES });
    const wrapped = envelopeFor(sender).wrap(inner, [own])._unsafeUnwrap();
    const data = StatementData.enc({
      tag: 'multiRequest',
      value: { encryptedRequest: wrapped.encryptedPayload, devicesInfo: wrapped.devicesInfo },
    });

    const event = (
      await singleDeviceDecoder().decodePeer(statementWith(data), specFor(sender.encryptionPublicKey))
    )._unsafeUnwrap();

    expect(event).toEqual({ tag: 'undecodable', requestId: null });
  });
});
