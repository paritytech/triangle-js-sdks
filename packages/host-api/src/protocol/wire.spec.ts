import { enumValue, fromHex, resultErr, resultOk, toHex } from '@novasamatech/scale';
import { describe, expect, it } from 'vitest';

import { CALL_ERROR_FAILURE, callErrorMarker } from './callError.js';
import { hostApiProtocol, lookupAddress } from './impl.js';
import {
  MessageType,
  decodeFrame,
  decodeProtocolError,
  encodeFrame,
  encodeUnsupportedMessage,
} from './messageCodec.js';
import { RequestCredentialsErr } from './v1/accounts.js';
import { PocketRemoveCardErr } from './v1/pocket.js';

// Golden bytes for the codec-3 wire (truapi `frame.rs`, RFC 0027). Fixtures
// marked "truapi" are copied verbatim from the Rust crate's own tests.

const { account, localStorage, pocket, renderer, signing } = hostApiProtocol;

describe('frame', () => {
  it('lays out [requestId][trait][method][message_type][payload]', () => {
    const bytes = encodeFrame({
      requestId: 'ab',
      traitId: 2,
      methodId: 1,
      messageType: MessageType.response,
      payload: new Uint8Array([0xaa, 0xbb]),
    });

    expect(toHex(bytes)).toBe('0x0861620201' + '01' + 'aabb');
  });

  it('round-trips, including an empty payload', () => {
    const frame = {
      requestId: 'req-1',
      traitId: 7,
      methodId: 3,
      messageType: MessageType.stop,
      payload: new Uint8Array(),
    };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });

  it('decodes a request id with a multi-byte compact length', () => {
    const requestId = 'x'.repeat(100);
    const frame = { requestId, traitId: 1, methodId: 0, messageType: 0, payload: new Uint8Array([1, 2]) };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });

  it('rejects a frame missing its header bytes', () => {
    expect(() => decodeFrame(fromHex('0x08616202'))).toThrow(/header/);
  });

  it('encodes the protocol error for an unsupported address', () => {
    expect(toHex(encodeUnsupportedMessage(200, 7))).toBe('0x0000c807');
    expect(decodeProtocolError(fromHex('0x0000c807'))).toEqual({ traitId: 200, methodId: 7 });
    // A later version or variant is not an error, just unreadable.
    expect(decodeProtocolError(fromHex('0x01'))).toBeNull();
    expect(decodeProtocolError(fromHex('0x0003'))).toBeNull();
  });
});

describe('addresses', () => {
  it('resolves every method by its (trait, method) pair', () => {
    expect(lookupAddress(2, 1)).toMatchObject({ trait: 'account', method: 'getAccount' });
    expect(lookupAddress(17, 0)).toMatchObject({ trait: 'renderer', method: 'render' });
    expect(lookupAddress(9, 4)).toMatchObject({ trait: 'payment', method: 'topUpStatusSubscribe' });
    expect(lookupAddress(4, 5)).toBeUndefined();
  });
});

describe('response leg: Result<Versioned<Ok>, CallError<Versioned<Err>>>', () => {
  const response = account.methods.getAccount.response;

  it('puts the version tag inside Ok', () => {
    const bytes = response.enc(enumValue('v1', resultOk({ publicKey: new Uint8Array([1, 2]) })));
    // Ok, V1, Vec<u8> [1, 2]
    expect(toHex(bytes)).toBe('0x0000080102');
    expect(response.dec(bytes)).toEqual(enumValue('v1', resultOk({ publicKey: new Uint8Array([1, 2]) })));
  });

  it('puts the version tag inside CallError::Domain', () => {
    const bytes = response.enc(enumValue('v1', resultErr(new RequestCredentialsErr.Rejected(undefined))));
    // Err, Domain, V1, Rejected
    expect(toHex(bytes)).toBe('0x01000001');
    const decoded = response.dec(bytes);
    expect(decoded.tag).toBe('v1');
    expect(decoded.value).toMatchObject({ success: false });
  });

  it.each([
    [{ tag: 'Denied' } as const, '0x0101'],
    [{ tag: 'Unsupported' } as const, '0x0102'],
    [{ tag: 'MalformedFrame', value: { reason: 'x' } } as const, '0x010304' + '78'],
    [{ tag: 'HostFailure', value: { reason: 'x' } } as const, '0x010404' + '78'],
    [{ tag: 'Cancelled' } as const, '0x0105'],
  ])('encodes the transport failure %o with no version tag', (failure, hex) => {
    const bytes = response.enc(enumValue('v1', callErrorMarker(failure)));
    expect(toHex(bytes)).toBe(hex);
    expect(response.dec(bytes)).toEqual({ tag: 'v1', value: { [CALL_ERROR_FAILURE]: failure } });
  });

  it('keeps unit responses to the Ok and version bytes', () => {
    const bytes = localStorage.methods.write.response.enc(enumValue('v1', resultOk(undefined)));
    expect(toHex(bytes)).toBe('0x0000');
  });
});

describe('interrupt leg: Result<(), CallError<Versioned<Err>>>', () => {
  const interrupt = account.methods.connectionStatusSubscribe.interrupt;

  it('encodes a clean completion as Ok(())', () => {
    expect(toHex(interrupt.enc({ tag: 'v1', value: undefined }))).toBe('0x00');
    expect(interrupt.dec(fromHex('0x00'))).toEqual({ tag: 'v1', value: undefined });
  });

  it('encodes a domain reason as Err(Domain(V1(..)))', () => {
    const bytes = fromHex('0x0100000478');
    const decoded = interrupt.dec(bytes);
    expect(decoded.tag).toBe('v1');
    expect(decoded.value).toMatchObject({ payload: { reason: 'x' } });
    expect(toHex(interrupt.enc(decoded))).toBe('0x0100000478');
  });

  it('encodes a transport failure as Err(CallError)', () => {
    const bytes = interrupt.enc({ tag: 'v1', value: callErrorMarker({ tag: 'Unsupported' }) });
    expect(toHex(bytes)).toBe('0x0102');
  });
});

describe('payloads', () => {
  // truapi: versioned/renderer.rs `render_request_carries_the_chat_context`
  it('renderer.render start carries the render context', () => {
    const bytes = renderer.methods.render.start.enc(
      enumValue('v1', {
        context: enumValue('ChatMessage', { roomId: 'room', messageId: 'message-1', messageType: 'vote' }),
        payload: new Uint8Array([1, 2]),
      }),
    );
    expect(toHex(bytes)).toBe('0x000010726f6f6d246d6573736167652d3110766f7465080102');
  });

  // truapi: versioned/renderer.rs `render_item_string_matches_the_wire_fixture`
  it('renderer.render item encodes a string node', () => {
    const bytes = renderer.methods.render.receive.enc(enumValue('v1', enumValue('String', 'Votes: 1')));
    expect(toHex(bytes)).toBe('0x000120566f7465733a2031');
  });

  it('renderer nodes without children match truapi: Spacer, TextField, Effect', () => {
    const node = renderer.methods.render.receive;
    expect(toHex(node.enc(enumValue('v1', enumValue('Spacer', { modifiers: [] }))))).toBe('0x000500');
    expect(
      toHex(
        node.enc(
          enumValue('v1', enumValue('Effect', { props: { effect: 'rainbow' as const }, children: [] as never[] })),
        ),
      ),
    ).toBe('0x000a0000');
  });

  // truapi: versioned/renderer.rs `action_item_button_payload_is_empty`
  it('renderer.actionSubscribe item carries a required payload', () => {
    const bytes = renderer.methods.actionSubscribe.receive.enc(
      enumValue('v1', {
        context: enumValue('PocketCard', { cardId: 'loyalty' }),
        actionId: 'vote',
        payload: new Uint8Array(),
      }),
    );
    expect(toHex(bytes)).toBe('0x00021c6c6f79616c747910766f746500');
  });

  // truapi: versioned/pocket.rs `privileged_removal_error_is_discriminant_zero`
  it('pocket.removeCard Privileged error is discriminant zero', () => {
    const bytes = pocket.methods.removeCard.response.enc(
      enumValue('v1', resultErr(new PocketRemoveCardErr.Privileged(undefined))),
    );
    // Err, Domain, then truapi's `V1(Privileged)` = 0x0000
    expect(toHex(bytes)).toBe('0x01000000');
  });

  it('localStorage.read v2 is tag 1 and names the owning product first', () => {
    const bytes = localStorage.methods.read.request.enc(enumValue('v2', { product: 'other.dot', key: 'k' }));
    expect(toHex(bytes)).toBe('0x010124' + toHex(new TextEncoder().encode('other.dot')).slice(2) + '046b');
    expect(toHex(localStorage.methods.read.request.enc(enumValue('v1', 'k')))).toBe('0x00046b');
  });

  it('signing payloads encode withSignedTransaction as OptionBool', () => {
    const payload = {
      blockHash: '0x',
      blockNumber: '0x',
      era: '0x',
      genesisHash: '0x',
      method: '0x',
      nonce: '0x',
      specVersion: '0x',
      tip: '0x',
      transactionVersion: '0x',
      signedExtensions: [] as string[],
      version: 4,
      assetId: undefined,
      metadataHash: undefined,
      mode: undefined,
      withSignedTransaction: false,
    } as const;
    const bytes = signing.methods.signPayloadWithLegacyAccount.request.enc(enumValue('v1', { signer: '', payload }));
    // ... version u32 LE, three `None`s, then OptionBool(false) = 0x02
    expect(toHex(bytes).endsWith('04000000' + '000000' + '02')).toBe(true);
  });

  it('createTransaction carries the contact handles last', () => {
    const request = signing.methods.createTransaction.request.enc(
      enumValue('v1', {
        signer: ['a.dot', enumValue('Index', 0)],
        genesisHash: `0x${'00'.repeat(32)}`,
        callData: new Uint8Array(),
        extensions: [],
        txExtVersion: 0,
        contacts: [{ bytes: new Uint8Array(32).fill(7) }],
      }),
    );
    expect(toHex(request).endsWith('00' + '04' + '07'.repeat(32))).toBe(true);
  });
});
