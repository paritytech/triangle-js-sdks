import type { RendererNodeType } from '@novasamatech/host-api';
import {
  ChatBotRegistrationErr,
  ChatMessagePostingErr,
  ChatRoomRegistrationErr,
  GenericError,
  createTransport,
  enumValue,
} from '@novasamatech/host-api';
import type { ChatMessageContent, RenderContext } from '@novasamatech/host-api-wrapper';
import {
  createProductChatManager,
  createProductRenderer,
  matchChatMessageRenderers,
} from '@novasamatech/host-api-wrapper';
import type { ContainerHandlerOf } from '@novasamatech/host-container';
import { createContainer } from '@novasamatech/host-container';

import { describe, expect, it, vi } from 'vitest';

import { delay } from './__mocks__/helpers.js';
import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

function setup() {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host);
  const sdkTransport = createTransport(providers.sdk);
  const chat = createProductChatManager(sdkTransport);
  const renderer = createProductRenderer(sdkTransport);

  return { container, chat, renderer };
}

function chatMessageContext(messageId: string, messageType: string, roomId = 'room'): RenderContext {
  return { tag: 'ChatMessage', value: { roomId, messageId, messageType } };
}

describe('Host API: Chat', () => {
  describe('room registration', () => {
    it('should register chat', async () => {
      const { container, chat } = setup();
      const registrationInfo = { roomId: 'test', name: 'test chat', icon: 'http://product.com/icon.png' };

      const handler = vi.fn<ContainerHandlerOf<typeof container.chat.handleCreateRoom>>((_, { ok }) =>
        ok({ status: 'New' }),
      );
      container.chat.handleCreateRoom(handler);

      await chat.registerRoom(registrationInfo);

      expect(handler).toHaveBeenCalledWith(registrationInfo, {
        ok: expect.any(Function),
        err: expect.any(Function),
        signal: expect.any(AbortSignal),
      });
    });

    it('should handle registration error', async () => {
      const { container, chat } = setup();
      const registrationInfo = { roomId: 'test', name: 'test chat', icon: 'http://product.com/icon.png' };
      const error = new ChatRoomRegistrationErr.Unknown({ reason: 'Registration service unavailable' });

      container.chat.handleCreateRoom((_, { err }) => err(error));

      await expect(chat.registerRoom(registrationInfo)).rejects.toEqual(error);
    });
  });

  describe('bot registration', () => {
    it('should register chat', async () => {
      const { container, chat } = setup();
      const registrationInfo = { botId: 'test', name: 'test chat', icon: 'http://product.com/icon.png' };

      const handler = vi.fn<ContainerHandlerOf<typeof container.chat.handleRegisterBot>>((_, { ok }) =>
        ok({ status: 'New' }),
      );
      container.chat.handleRegisterBot(handler);

      await chat.registerBot(registrationInfo);

      expect(handler).toHaveBeenCalledWith(registrationInfo, {
        ok: expect.any(Function),
        err: expect.any(Function),
        signal: expect.any(AbortSignal),
      });
    });

    it('should handle registration error', async () => {
      const { container, chat } = setup();
      const registrationInfo = { botId: 'test', name: 'test chat', icon: 'http://product.com/icon.png' };
      const error = new ChatBotRegistrationErr.Unknown({ reason: 'Registration service unavailable' });

      container.chat.handleRegisterBot((_, { err }) => err(error));

      await expect(chat.registerBot(registrationInfo)).rejects.toEqual(error);
    });
  });

  describe('send message', () => {
    it('should send message', async () => {
      const { container, chat } = setup();
      const registrationInfo = { roomId: 'test', name: 'test chat', icon: 'http://product.com/icon.png' };
      const message: ChatMessageContent = enumValue('Text', 'test message');
      const response = { messageId: 'hello' };

      container.chat.handleCreateRoom((_, { ok }) => ok({ status: 'New' }));
      const handler = vi.fn<ContainerHandlerOf<typeof container.chat.handlePostMessage>>((_, { ok }) => ok(response));
      container.chat.handlePostMessage(handler);

      await chat.registerRoom(registrationInfo);
      const result = await chat.sendMessage('test', message);

      expect(handler).toHaveBeenCalledWith(
        { roomId: registrationInfo.roomId, payload: message },
        { ok: expect.any(Function), err: expect.any(Function), signal: expect.any(AbortSignal) },
      );
      expect(result).toEqual(response);
    });

    it('should handle send message error', async () => {
      const { container, chat } = setup();
      const registrationInfo = { roomId: 'test', name: 'test chat', icon: 'http://product.com/icon.png' };
      const message: ChatMessageContent = enumValue('Text', 'test message');
      const error = new ChatMessagePostingErr.Unknown({ reason: 'Message delivery failed' });

      container.chat.handleCreateRoom((_, { ok }) => ok({ status: 'New' }));
      container.chat.handlePostMessage((_, { err }) => err(error));

      await chat.registerRoom(registrationInfo);

      await expect(chat.sendMessage('test', message)).rejects.toEqual(error);
    });
  });

  // `product_chat_custom_message_render_subscribe` was replaced by the renderer
  // trait: the host starts `renderer.render` with a `ChatMessage` context and the
  // product serves it through `productRenderer.onRender`.
  describe('custom message rendering', () => {
    const textNode: RendererNodeType = {
      tag: 'Text',
      value: {
        modifiers: [],
        props: { style: undefined, color: undefined },
        children: [{ tag: 'String', value: 'hello' }],
      },
    };

    it('should deliver render request to product and receive rendered node', async () => {
      const { container, renderer } = setup();
      const expectedRoomId = 'room-1';
      const expectedMessageId = '1';
      const expectedMessageType = 'my-type';
      const expectedPayload = new Uint8Array([1, 2, 3]);

      const renderFn = vi.fn<Parameters<typeof matchChatMessageRenderers>[0][string]>((_params, render) => {
        render(textNode);
        return () => {
          /* cleanup */
        };
      });
      renderer.onRender(matchChatMessageRenderers({ [expectedMessageType]: renderFn }));

      const callback = vi.fn();
      const subscription = container.renderer.render(
        {
          context: chatMessageContext(expectedMessageId, expectedMessageType, expectedRoomId),
          payload: expectedPayload,
        },
        callback,
      );

      await delay(10);

      expect(renderFn).toHaveBeenCalledOnce();
      expect(renderFn).toHaveBeenCalledWith(
        expect.objectContaining({
          roomId: expectedRoomId,
          messageId: expectedMessageId,
          messageType: expectedMessageType,
          payload: expectedPayload,
        }),
        expect.any(Function),
      );
      expect(callback).toHaveBeenCalledWith(textNode);

      subscription.unsubscribe();
    });

    it('should stream successive trees in order', async () => {
      const { container, renderer } = setup();
      const secondNode: RendererNodeType = { tag: 'String', value: 'second' };

      renderer.onRender((_request, render) => {
        render(textNode);
        render(secondNode);
        return () => {
          /* cleanup */
        };
      });

      const callback = vi.fn();
      container.renderer.render({ context: chatMessageContext('0', 'type'), payload: new Uint8Array() }, callback);

      await delay(10);

      expect(callback.mock.calls).toEqual([[textNode], [secondNode]]);
    });

    it('should call product cleanup on unsubscribe', async () => {
      const { container, renderer } = setup();
      const cleanupFn = vi.fn();

      renderer.onRender((_request, render) => {
        render(textNode);
        return cleanupFn;
      });

      const subscription = container.renderer.render(
        { context: chatMessageContext('0', 'type'), payload: new Uint8Array() },
        vi.fn(),
      );

      await delay(10);
      subscription.unsubscribe();
      await delay(10);

      expect(cleanupFn).toHaveBeenCalledOnce();
    });

    it('should end the stream with an error for an unknown message type', async () => {
      const { container, renderer } = setup();
      const renderFn = vi.fn(() => () => {
        /* cleanup */
      });

      renderer.onRender(matchChatMessageRenderers({ known: renderFn }));

      const callback = vi.fn();
      const reasons: unknown[] = [];
      container.renderer
        .render({ context: chatMessageContext('0', 'unknown'), payload: new Uint8Array() }, callback)
        .onInterrupt(reason => reasons.push(reason));

      await delay(10);

      expect(renderFn).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
      expect(reasons).toEqual([new GenericError({ reason: 'Renderer for message type unknown is not defined' })]);
    });

    it('should complete cleanly when the product ends the stream without a reason', async () => {
      const { container, renderer } = setup();
      const cleanupFn = vi.fn();

      renderer.onRender(({ end }, render) => {
        render(textNode);
        end();
        return cleanupFn;
      });

      const callback = vi.fn();
      const reasons: unknown[] = [];
      container.renderer
        .render({ context: chatMessageContext('0', 'type'), payload: new Uint8Array() }, callback)
        .onInterrupt(reason => reasons.push(reason));

      await delay(10);

      expect(callback).toHaveBeenCalledWith(textNode);
      expect(reasons).toEqual([undefined]);
      expect(cleanupFn).toHaveBeenCalledOnce();
    });
  });

  describe('renderer actions', () => {
    it('should route renderer.actionSubscribe actions to the body with the matching context', async () => {
      const { container, renderer } = setup();
      const context = chatMessageContext('msg-1', 'counter');
      const otherContext = chatMessageContext('msg-2', 'counter');
      const pressPayload = new Uint8Array();
      const textPayload = new TextEncoder().encode('typed');

      container.renderer.handleActionSubscribe((_params, send) => {
        // Only start emitting once the product body is open.
        const timer = setTimeout(() => {
          send({ context: otherContext, actionId: 'increment', payload: pressPayload });
          send({ context, actionId: 'increment', payload: pressPayload });
          send({ context, actionId: 'rename', payload: textPayload });
        }, 20);
        return () => clearTimeout(timer);
      });

      const bodyActions: [string, Uint8Array][] = [];
      renderer.onRender(({ subscribeActions }, render) => {
        render({ tag: 'String', value: 'body' });
        return subscribeActions((actionId, payload) => bodyActions.push([actionId, payload]));
      });

      container.renderer.render({ context, payload: new Uint8Array() }, vi.fn());

      await delay(50);

      expect(bodyActions).toEqual([
        ['increment', pressPayload],
        ['rename', textPayload],
      ]);
    });

    it('should deliver every action with its context through subscribeActions', async () => {
      const { container, renderer } = setup();
      const actions = [
        { context: chatMessageContext('msg-1', 'counter'), actionId: 'increment', payload: new Uint8Array() },
        {
          context: { tag: 'PocketCard', value: { cardId: 'card-7' } } as const,
          actionId: 'open',
          payload: new Uint8Array(),
        },
      ];

      const handler = vi.fn<Parameters<typeof container.renderer.handleActionSubscribe>[0]>((_params, send) => {
        actions.forEach(send);
        return () => {
          /* cleanup */
        };
      });
      container.renderer.handleActionSubscribe(handler);

      const received: unknown[] = [];
      const subscription = renderer.subscribeActions(action => received.push(action));

      await delay(10);

      expect(handler).toHaveBeenCalledWith(undefined, expect.any(Function), expect.any(Function));
      expect(received).toEqual(actions);

      subscription.unsubscribe();
    });

    it('should interrupt the action subscription with the host error', async () => {
      const { container, renderer } = setup();
      const error = new GenericError({ reason: 'renderer unavailable' });

      container.renderer.handleActionSubscribe((_params, _send, interrupt) => {
        interrupt(error);
        return () => {
          /* cleanup */
        };
      });

      const reasons: unknown[] = [];
      renderer.subscribeActions(vi.fn()).onInterrupt(reason => reasons.push(reason));

      await delay(10);

      expect(reasons).toEqual([error]);
    });
  });

  it('should react to message', async () => {
    const { container, chat } = setup();
    const registrationInfo = { roomId: 'test', name: 'test chat', icon: 'http://product.com/icon.png' };
    const message: ChatMessageContent = enumValue('Text', 'test message');

    container.chat.handleCreateRoom((_, { ok }) => ok({ status: 'New' }));
    container.chat.handleActionSubscribe((_, send) => {
      // sending back and forth
      return container.chat.handlePostMessage((message, { ok }) => {
        send({ roomId: message.roomId, peer: 'test', payload: enumValue('MessagePosted', message.payload) });
        return ok({ messageId: 'hello' });
      });
    });

    const handler = vi.fn();

    chat.subscribeAction(handler);

    await chat.registerRoom(registrationInfo);
    await chat.sendMessage('test', message);

    expect(handler).toHaveBeenCalledWith({
      roomId: registrationInfo.roomId,
      peer: 'test',
      payload: enumValue('MessagePosted', message),
    });
  });
});
