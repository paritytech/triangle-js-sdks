import {
  ChatBotRegistrationErr,
  ChatMessagePostingErr,
  ChatRoomRegistrationErr,
  createTransport,
  enumValue,
} from '@novasamatech/host-api';
import { createContainer } from '@novasamatech/host-container';
import type { ChatMessageContent } from '@novasamatech/product-sdk';
import { createProductChatManager } from '@novasamatech/product-sdk';

import { describe, expect, it, vi } from 'vitest';

import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

function setup() {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host);
  const sdkTransport = createTransport(providers.sdk);
  const chat = createProductChatManager(sdkTransport);

  return { container, chat };
}

describe('Host API: Chat', () => {
  describe('room registration', () => {
    it('should register chat', async () => {
      const { container, chat } = setup();
      const registrationInfo = { roomId: 'test', name: 'test chat', icon: 'http://product.com/icon.png' };

      const handler = vi.fn<Parameters<typeof container.handleChatCreateRoom>[0]>((_, { ok }) => ok({ status: 'New' }));
      container.handleChatCreateRoom(handler);

      await chat.registerRoom(registrationInfo);

      expect(handler).toBeCalledWith(registrationInfo, { ok: expect.any(Function), err: expect.any(Function) });
    });

    it('should handle registration error', async () => {
      const { container, chat } = setup();
      const registrationInfo = { roomId: 'test', name: 'test chat', icon: 'http://product.com/icon.png' };
      const error = new ChatRoomRegistrationErr.Unknown({ reason: 'Registration service unavailable' });

      container.handleChatCreateRoom((_, { err }) => err(error));

      await expect(chat.registerRoom(registrationInfo)).rejects.toEqual(error);
    });
  });

  describe('bot registration', () => {
    it('should register chat', async () => {
      const { container, chat } = setup();
      const registrationInfo = { botId: 'test', name: 'test chat', icon: 'http://product.com/icon.png' };

      const handler = vi.fn<Parameters<typeof container.handleChatBotRegistration>[0]>((_, { ok }) =>
        ok({ status: 'New' }),
      );
      container.handleChatBotRegistration(handler);

      await chat.registerBot(registrationInfo);

      expect(handler).toBeCalledWith(registrationInfo, { ok: expect.any(Function), err: expect.any(Function) });
    });

    it('should handle registration error', async () => {
      const { container, chat } = setup();
      const registrationInfo = { botId: 'test', name: 'test chat', icon: 'http://product.com/icon.png' };
      const error = new ChatBotRegistrationErr.Unknown({ reason: 'Registration service unavailable' });

      container.handleChatBotRegistration((_, { err }) => err(error));

      await expect(chat.registerBot(registrationInfo)).rejects.toEqual(error);
    });
  });

  describe('send message', () => {
    it('should send message', async () => {
      const { container, chat } = setup();
      const registrationInfo = { roomId: 'test', name: 'test chat', icon: 'http://product.com/icon.png' };
      const message: ChatMessageContent = enumValue('Text', 'test message');
      const response = { messageId: 'hello' };

      container.handleChatCreateRoom((_, { ok }) => ok({ status: 'New' }));
      const handler = vi.fn<Parameters<typeof container.handleChatPostMessage>[0]>((_, { ok }) => ok(response));
      container.handleChatPostMessage(handler);

      await chat.registerRoom(registrationInfo);
      const result = await chat.sendMessage('test', message);

      expect(handler).toBeCalledWith(
        { roomId: registrationInfo.roomId, payload: message },
        { ok: expect.any(Function), err: expect.any(Function) },
      );
      expect(result).toEqual(response);
    });

    it('should handle send message error', async () => {
      const { container, chat } = setup();
      const registrationInfo = { roomId: 'test', name: 'test chat', icon: 'http://product.com/icon.png' };
      const message: ChatMessageContent = enumValue('Text', 'test message');
      const error = new ChatMessagePostingErr.Unknown({ reason: 'Message delivery failed' });

      container.handleChatCreateRoom((_, { ok }) => ok({ status: 'New' }));
      container.handleChatPostMessage((_, { err }) => err(error));

      await chat.registerRoom(registrationInfo);

      await expect(chat.sendMessage('test', message)).rejects.toEqual(error);
    });
  });

  it('should react to message', async () => {
    const { container, chat } = setup();
    const registrationInfo = { roomId: 'test', name: 'test chat', icon: 'http://product.com/icon.png' };
    const message: ChatMessageContent = enumValue('Text', 'test message');

    container.handleChatCreateRoom((_, { ok }) => ok({ status: 'New' }));
    container.handleChatActionSubscribe((_, send) => {
      // sending back and forth
      return container.handleChatPostMessage((message, { ok }) => {
        send({ roomId: message.roomId, peer: 'test', payload: enumValue('MessagePosted', message.payload) });
        return ok({ messageId: 'hello' });
      });
    });

    const handler = vi.fn();

    chat.subscribeAction(handler);

    await chat.registerRoom(registrationInfo);
    await chat.sendMessage('test', message);

    expect(handler).toBeCalledWith({
      roomId: registrationInfo.roomId,
      peer: 'test',
      payload: enumValue('MessagePosted', message),
    });
  });
});
