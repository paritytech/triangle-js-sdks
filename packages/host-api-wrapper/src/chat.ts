import type {
  ChatBotRegistrationStatus as ChatBotRegistrationStatusCodec,
  ChatMessageContent as ChatMessageContentCodec,
  ChatRoom as ChatRoomCodec,
  ChatRoomRegistrationStatus as ChatRoomRegistrationStatusCodec,
  CodecType,
  ReceivedChatAction as ReceivedChatActionCodec,
  Subscription,
  Transport,
} from '@novasamatech/host-api';
import { createHostApi, enumValue } from '@novasamatech/host-api';

import type { GenericInterrupt } from './helpers.js';
import { genericInterrupt, unwrapVersionedSubscription } from './helpers.js';
import { sandboxTransport } from './sandboxTransport.js';

export type ChatMessageContent = CodecType<typeof ChatMessageContentCodec>;
export type ChatReceivedAction = CodecType<typeof ReceivedChatActionCodec>;
export type ChatRoomRegistrationResult = CodecType<typeof ChatRoomRegistrationStatusCodec>;
export type ChatBotRegistrationResult = CodecType<typeof ChatBotRegistrationStatusCodec>;
export type ChatRoom = CodecType<typeof ChatRoomCodec>;

export const createProductChatManager = (transport: Transport = sandboxTransport) => {
  const hostApi = createHostApi(transport);
  const roomRegistrationStatus: Record<string, ChatRoomRegistrationResult> = {};
  const botRegistrationStatus: Record<string, ChatBotRegistrationResult> = {};

  const chat = {
    async registerRoom(params: { roomId: string; name: string; icon: string }) {
      const existingRegistration = roomRegistrationStatus[params.roomId];
      if (existingRegistration) {
        return existingRegistration;
      }

      const result = await hostApi.chat.createRoom(enumValue('v1', params));

      return result.match(
        payload => {
          switch (payload.tag) {
            case 'v1': {
              roomRegistrationStatus[params.roomId] = payload.value.status;
              return payload.value.status;
            }
            default:
              throw new Error(`Unknown message version ${payload.tag}`);
          }
        },
        err => {
          throw err.value;
        },
      );
    },
    async registerBot(params: { botId: string; name: string; icon: string }) {
      const existingRegistration = botRegistrationStatus[params.botId];
      if (existingRegistration) {
        return existingRegistration;
      }

      const result = await hostApi.chat.registerBot(enumValue('v1', params));

      return result.match(
        payload => {
          switch (payload.tag) {
            case 'v1': {
              botRegistrationStatus[params.botId] = payload.value.status;
              return payload.value.status;
            }
            default:
              throw new Error(`Unknown message version ${payload.tag}`);
          }
        },
        err => {
          throw err.value;
        },
      );
    },
    async sendMessage(roomId: string, payload: ChatMessageContent) {
      const result = await hostApi.chat.postMessage(enumValue('v1', { roomId, payload }));

      return result.match(
        payload => {
          switch (payload.tag) {
            case 'v1': {
              return { messageId: payload.value.messageId };
            }
            default:
              throw new Error(`Unknown message version ${payload.tag}`);
          }
        },
        err => {
          throw err.value;
        },
      );
    },
    subscribeChatList(callback: (rooms: ChatRoom[]) => void): Subscription<GenericInterrupt | undefined> {
      return unwrapVersionedSubscription(
        hostApi.chat.listSubscribe(enumValue('v1', undefined), action => {
          if (action.tag === 'v1') {
            callback(action.value);
          }
        }),
        genericInterrupt,
      );
    },
    /**
     * Subscribes to chat activity addressed to this product: posted messages,
     * slash commands, and presses on the buttons the host draws for an
     * `Actions` message. Actions inside a product-rendered `Custom` message
     * arrive through the renderer instead (see `createProductRenderer`).
     */
    subscribeAction(callback: (action: ChatReceivedAction) => void): Subscription<GenericInterrupt | undefined> {
      return unwrapVersionedSubscription(
        hostApi.chat.actionSubscribe(enumValue('v1', undefined), action => {
          switch (action.tag) {
            case 'v1':
              callback(action.value);
              break;
            default:
              console.error(`Unknown message version ${action.tag}`);
          }
        }),
        genericInterrupt,
      );
    },
  };

  return chat;
};
