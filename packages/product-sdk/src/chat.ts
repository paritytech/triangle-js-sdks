import type {
  ChatMessageContent as ChatMessageContentCodec,
  ChatRoom as ChatRoomCodec,
  ChatRoomRegistrationResult as ChatRoomRegistrationResultCodec,
  CodecType,
  ReceivedChatAction as ReceivedChatActionCodec,
  Transport,
} from '@novasamatech/host-api';
import { createHostApi, enumValue } from '@novasamatech/host-api';

import { promiseWithResolvers } from './helpers.js';
import { sandboxTransport } from './sandboxTransport.js';

promiseWithResolvers();

export type ChatMessageContent = CodecType<typeof ChatMessageContentCodec>;
export type ReceivedChatAction = CodecType<typeof ReceivedChatActionCodec>;
export type ChatRoomRegistrationResult = CodecType<typeof ChatRoomRegistrationResultCodec>;
export type ChatRoom = CodecType<typeof ChatRoomCodec>;

export const createChat = (transport: Transport = sandboxTransport) => {
  const hostApi = createHostApi(transport);
  let registrationStatus: ChatRoomRegistrationResult | null = null;

  const messageQueue: {
    roomId: string;
    content: ChatMessageContent;
    resolve: (response: { messageId: string }) => void;
    reject: (reason: unknown) => void;
  }[] = [];

  const chat = {
    async register(params: { roomId: string; name: string; icon: string }) {
      if (registrationStatus) {
        return registrationStatus;
      }

      const result = await hostApi.chatCreateRoom(enumValue('v1', params));

      return result.match(
        payload => {
          if (payload.tag === 'v1') {
            registrationStatus = payload.value;

            if (messageQueue.length > 0) {
              messageQueue.forEach(({ roomId, content, resolve, reject }) => {
                chat.sendMessage(roomId, content).then(resolve, reject);
              });
              messageQueue.length = 0;
            }

            return registrationStatus;
          } else {
            throw new Error(`Unknown message version ${payload.tag}`);
          }
        },
        err => {
          throw err.value;
        },
      );
    },
    async sendMessage(roomId: string, payload: ChatMessageContent) {
      if (registrationStatus) {
        const result = await hostApi.chatPostMessage(enumValue('v1', { roomId, payload }));

        return result.match(
          payload => {
            if (payload.tag === 'v1') {
              return { messageId: payload.value.messageId };
            } else {
              throw new Error(`Unknown message version ${payload.tag}`);
            }
          },
          err => {
            throw err.value;
          },
        );
      } else {
        const { promise, resolve, reject } = promiseWithResolvers<{ messageId: string }>();
        messageQueue.push({ roomId, content: payload, resolve, reject });
        return promise;
      }
    },
    subscribeChatList(callback: (rooms: ChatRoom[]) => void) {
      return hostApi.chatListSubscribe(enumValue('v1', undefined), action => {
        if (action.tag === 'v1') {
          callback(action.value);
        }
      });
    },
    subscribeAction(callback: (action: ReceivedChatAction) => void) {
      return hostApi.chatActionSubscribe(enumValue('v1', undefined), action => {
        if (action.tag === 'v1') {
          callback(action.value);
        }
      });
    },
  };

  return chat;
};
