import type { Logger, Provider } from '@novasamatech/host-api';
import {
  PaymentBalanceErr,
  PaymentTopUpErr,
  enumValue,
  hostApiProtocol,
  resultErr,
  toHex,
} from '@novasamatech/host-api';
import { describe, expect, it, vi } from 'vitest';

import { createContainer } from './createContainer.js';

const REQUEST_ID = 'p:1';

const silentLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  log: vi.fn(),
  withPrefix: () => silentLogger,
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// Compact mode 0b00 covers the short request ids used in tests.
function encodeRequestId(requestId: string): Uint8Array {
  const utf8 = textEncoder.encode(requestId);
  return Uint8Array.from([utf8.length << 2, ...utf8]);
}

// `[compact length][utf8 requestId][action id u8][payload]`
function buildFrame(actionIndex: number, payload: Uint8Array, requestId = REQUEST_ID): Uint8Array {
  const requestIdBytes = encodeRequestId(requestId);
  const frame = new Uint8Array(requestIdBytes.length + 1 + payload.length);
  frame.set(requestIdBytes, 0);
  frame[requestIdBytes.length] = actionIndex;
  frame.set(payload, requestIdBytes.length + 1);
  return frame;
}

function parseFrame(frame: Uint8Array) {
  const requestIdLength = (frame[0] ?? 0) >>> 2;
  return {
    requestId: textDecoder.decode(frame.subarray(1, 1 + requestIdLength)),
    actionIndex: frame[1 + requestIdLength] ?? -1,
    payload: toHex(frame.slice(2 + requestIdLength)),
  };
}

function createHarness() {
  const listeners = new Set<(message: Uint8Array) => void>();
  const outbound: Uint8Array[] = [];
  const provider: Provider = {
    logger: silentLogger,
    isCorrectEnvironment: () => true,
    dispose: () => listeners.clear(),
    subscribe: callback => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    postMessage: message => outbound.push(message),
  };

  return {
    container: createContainer(provider),
    inject: (frame: Uint8Array) => {
      for (const listener of [...listeners]) listener(frame);
    },
    // Handshake pings use generated request ids, so filtering on the
    // injected id isolates the frames answering the injected request.
    framesFor: (requestId: string) => outbound.map(parseFrame).filter(frame => frame.requestId === requestId),
  };
}

const topUp = hostApiProtocol.host_payment_top_up;
const balanceSubscribe = hostApiProtocol.host_payment_balance_subscribe;

const topUpRequestPayload = () =>
  topUp.request.enc(enumValue('v1', { into: undefined, amount: 1n, source: enumValue('ProductAccount', 0) }));

const balanceStartPayload = () => balanceSubscribe.start.enc(enumValue('v1', { purse: undefined }));

const topUpErrorResponse = (reason: string) =>
  toHex(topUp.response.enc(enumValue('v1', resultErr(new PaymentTopUpErr.Unknown({ reason })))));

const balanceInterrupt = (reason: string) =>
  toHex(balanceSubscribe.interrupt.enc(enumValue('v1', new PaymentBalanceErr.Unknown({ reason }))));

async function expectSingleFrame(harness: ReturnType<typeof createHarness>) {
  await vi.waitFor(() => expect(harness.framesFor(REQUEST_ID)).toHaveLength(1));
  const [frame] = harness.framesFor(REQUEST_ID);
  if (!frame) throw new Error('unreachable: frame is present');
  return frame;
}

describe('createContainer terminal frames', () => {
  describe('request faults', () => {
    it('answers the catch-all error when a request handler throws synchronously', async () => {
      const harness = createHarness();
      harness.container.handlePaymentTopUp(() => {
        throw new Error('boom');
      });

      harness.inject(buildFrame(topUp.index, topUpRequestPayload()));

      const frame = await expectSingleFrame(harness);
      expect(frame.actionIndex).toBe(topUp.index + 1);
      expect(frame.payload).toBe(topUpErrorResponse('boom'));
    });

    it('answers the catch-all error when a request handler rejects', async () => {
      const harness = createHarness();
      harness.container.handlePaymentTopUp(async () => {
        throw new Error('async boom');
      });

      harness.inject(buildFrame(topUp.index, topUpRequestPayload()));

      const frame = await expectSingleFrame(harness);
      expect(frame.actionIndex).toBe(topUp.index + 1);
      expect(frame.payload).toBe(topUpErrorResponse('async boom'));
    });

    it('answers the catch-all error for an unsupported request version tag', async () => {
      const harness = createHarness();
      const payload = topUpRequestPayload();
      payload[0] = 0x01; // pretend v2

      harness.inject(buildFrame(topUp.index, payload));

      const frame = await expectSingleFrame(harness);
      expect(frame.actionIndex).toBe(topUp.index + 1);
      expect(frame.payload).toBe(topUpErrorResponse('Unsupported version'));
    });

    it('answers the catch-all error for an undecodable request payload', async () => {
      const harness = createHarness();

      harness.inject(buildFrame(topUp.index, Uint8Array.from([0x00, 0xff])));

      const frame = await expectSingleFrame(harness);
      expect(frame.actionIndex).toBe(topUp.index + 1);
      expect(frame.payload).toBe(topUpErrorResponse('Unsupported message format'));
    });
  });

  describe('subscription faults', () => {
    it('interrupts with the default error when a start handler throws', async () => {
      const harness = createHarness();
      harness.container.handlePaymentBalanceSubscribe(() => {
        throw new Error('boom');
      });

      harness.inject(buildFrame(balanceSubscribe.index, balanceStartPayload()));

      const frame = await expectSingleFrame(harness);
      expect(frame.actionIndex).toBe(balanceSubscribe.index + 2);
      expect(frame.payload).toBe(balanceInterrupt('boom'));
    });

    it('interrupts for an unsupported start version tag', async () => {
      const harness = createHarness();
      const payload = balanceStartPayload();
      payload[0] = 0x01; // pretend v2

      harness.inject(buildFrame(balanceSubscribe.index, payload));

      const frame = await expectSingleFrame(harness);
      expect(frame.actionIndex).toBe(balanceSubscribe.index + 2);
      expect(frame.payload).toBe(balanceInterrupt('Unsupported version'));
    });

    it('interrupts for an undecodable start payload', async () => {
      const harness = createHarness();

      harness.inject(buildFrame(balanceSubscribe.index, Uint8Array.from([0x00, 0xff])));

      const frame = await expectSingleFrame(harness);
      expect(frame.actionIndex).toBe(balanceSubscribe.index + 2);
      expect(frame.payload).toBe(balanceInterrupt('Unsupported message format'));
    });
  });

  describe('unchanged behavior', () => {
    it('still answers Not implemented for unregistered requests', async () => {
      const harness = createHarness();

      harness.inject(buildFrame(topUp.index, topUpRequestPayload()));

      const frame = await expectSingleFrame(harness);
      expect(frame.actionIndex).toBe(topUp.index + 1);
      expect(frame.payload).toBe(topUpErrorResponse('Not implemented'));
    });

    it('answers exactly one frame when a registered handler returns a domain error', async () => {
      const harness = createHarness();
      harness.container.handlePaymentTopUp((_params, { err }) => err(new PaymentTopUpErr.Unknown({ reason: 'x' })));

      harness.inject(buildFrame(topUp.index, topUpRequestPayload()));

      await vi.waitFor(() => expect(harness.framesFor(REQUEST_ID)).toHaveLength(1));
      // give any duplicate answer a chance to arrive before asserting
      await new Promise(resolve => setTimeout(resolve, 20));
      const frames = harness.framesFor(REQUEST_ID);
      expect(frames).toHaveLength(1);
      expect(frames[0]?.payload).toBe(topUpErrorResponse('x'));
    });

    it('keeps dropping frames with unknown action ids', async () => {
      const harness = createHarness();

      harness.inject(buildFrame(0xfa, Uint8Array.from([0xff])));

      await new Promise(resolve => setTimeout(resolve, 20));
      expect(harness.framesFor(REQUEST_ID)).toHaveLength(0);
    });
  });
});
