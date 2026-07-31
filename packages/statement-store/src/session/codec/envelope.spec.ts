import { x25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';

import type { DeviceTarget } from './envelope.js';
import { createEnvelope } from './envelope.js';

function createDevice(): DeviceTarget & { encryptionPrivateKey: Uint8Array } {
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

const PLAINTEXT = new TextEncoder().encode('inner Request bytes');

describe('multi-device envelope', () => {
  it('a recipient device opens the envelope addressed to it', () => {
    const sender = createDevice();
    const recipientA = createDevice();
    const recipientB = createDevice();

    const wrapped = envelopeFor(sender).wrap(PLAINTEXT, [recipientA, recipientB])._unsafeUnwrap();

    expect(wrapped.devicesInfo).toHaveLength(2);

    for (const recipient of [recipientA, recipientB]) {
      const opened = envelopeFor(recipient)
        .unwrapForOwnDevice(wrapped.encryptedPayload, wrapped.devicesInfo, sender.encryptionPublicKey)
        ._unsafeUnwrap();

      expect(opened).toEqual(PLAINTEXT);
    }
  });

  // The premise the whole "no client-side outbox" design rests on: the per-device wrap
  // secret is x25519(senderPriv, recipientPub), so the SENDER can re-derive it for any
  // recipient and read its own envelope back out of the statement store.
  it('the sender reads back its own envelope via any recipient it wrapped for', () => {
    const sender = createDevice();
    const recipientA = createDevice();
    const recipientB = createDevice();
    const recipients = [recipientA, recipientB];

    const senderEnvelope = envelopeFor(sender);
    const wrapped = senderEnvelope.wrap(PLAINTEXT, recipients)._unsafeUnwrap();

    expect(senderEnvelope.unwrapOwn(wrapped.encryptedPayload, wrapped.devicesInfo, recipients)._unsafeUnwrap()).toEqual(
      PLAINTEXT,
    );
    // …and with only the second recipient known, so the loop is genuinely per-device.
    expect(
      senderEnvelope.unwrapOwn(wrapped.encryptedPayload, wrapped.devicesInfo, [recipientB])._unsafeUnwrap(),
    ).toEqual(PLAINTEXT);
  });

  it('skips a stale roster entry and opens via a device that still matches', () => {
    const sender = createDevice();
    const live = createDevice();
    // Same account id as `live`, but a rotated encryption key — its unwrap must fail and
    // the loop must keep going rather than give up on the first mismatch.
    const rotated = createDevice();
    const stale: DeviceTarget = {
      statementAccountId: rotated.statementAccountId,
      encryptionPublicKey: createDevice().encryptionPublicKey,
    };

    const senderEnvelope = envelopeFor(sender);
    const wrapped = senderEnvelope.wrap(PLAINTEXT, [rotated, live])._unsafeUnwrap();

    expect(
      senderEnvelope.unwrapOwn(wrapped.encryptedPayload, wrapped.devicesInfo, [stale, live])._unsafeUnwrap(),
    ).toEqual(PLAINTEXT);
  });

  it('rejects a device that is not a recipient', () => {
    const sender = createDevice();
    const recipient = createDevice();
    const outsider = createDevice();

    const wrapped = envelopeFor(sender).wrap(PLAINTEXT, [recipient])._unsafeUnwrap();

    expect(
      envelopeFor(outsider)
        .unwrapForOwnDevice(wrapped.encryptedPayload, wrapped.devicesInfo, sender.encryptionPublicKey)
        .isErr(),
    ).toBe(true);
  });

  it('rejects the right device holding the wrong sender key', () => {
    const sender = createDevice();
    const impostor = createDevice();
    const recipient = createDevice();

    const wrapped = envelopeFor(sender).wrap(PLAINTEXT, [recipient])._unsafeUnwrap();

    expect(
      envelopeFor(recipient)
        .unwrapForOwnDevice(wrapped.encryptedPayload, wrapped.devicesInfo, impostor.encryptionPublicKey)
        .isErr(),
    ).toBe(true);
  });

  it('rejects a tampered payload (AEAD tag)', () => {
    const sender = createDevice();
    const recipient = createDevice();

    const wrapped = envelopeFor(sender).wrap(PLAINTEXT, [recipient])._unsafeUnwrap();
    const tampered = Uint8Array.from(wrapped.encryptedPayload);
    const last = tampered.length - 1;
    tampered[last] = (tampered[last] ?? 0) ^ 0xff;

    expect(
      envelopeFor(recipient).unwrapForOwnDevice(tampered, wrapped.devicesInfo, sender.encryptionPublicKey).isErr(),
    ).toBe(true);
  });

  it('refuses to wrap without recipients', () => {
    expect(envelopeFor(createDevice()).wrap(PLAINTEXT, []).isErr()).toBe(true);
  });

  it('produces a fresh one-shot key per wrap', () => {
    const sender = createDevice();
    const recipient = createDevice();
    const senderEnvelope = envelopeFor(sender);

    const first = senderEnvelope.wrap(PLAINTEXT, [recipient])._unsafeUnwrap();
    const second = senderEnvelope.wrap(PLAINTEXT, [recipient])._unsafeUnwrap();

    expect(first.encryptedPayload).not.toEqual(second.encryptedPayload);
    expect(first.devicesInfo[0]!.encryptedKey).not.toEqual(second.devicesInfo[0]!.encryptedKey);
  });
});
