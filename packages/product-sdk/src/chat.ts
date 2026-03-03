import type {
  ChatBotRegistrationStatus as ChatBotRegistrationStatusCodec,
  ChatMessageContent as ChatMessageContentCodec,
  ChatRoom as ChatRoomCodec,
  ChatRoomRegistrationStatus as ChatRoomRegistrationStatusCodec,
  CodecType,
  ReceivedChatAction as ReceivedChatActionCodec,
  Transport,
} from '@novasamatech/host-api';
import { CustomRendererNode, createHostApi, enumValue } from '@novasamatech/host-api';

import { sandboxTransport } from './sandboxTransport.js';

export type ChatMessageContent = CodecType<typeof ChatMessageContentCodec>;
export type ChatReceivedAction = CodecType<typeof ReceivedChatActionCodec>;
export type ChatRoomRegistrationResult = CodecType<typeof ChatRoomRegistrationStatusCodec>;
export type ChatBotRegistrationResult = CodecType<typeof ChatBotRegistrationStatusCodec>;
export type ChatRoom = CodecType<typeof ChatRoomCodec>;

export type ChatCustomMessageRenderer = (
  params: ChatCustomMessageRendererParams,
  render: (node: CodecType<typeof CustomRendererNode>) => void,
) => VoidFunction;

export type ChatCustomMessageRendererParams<T = Uint8Array> = {
  messageId: string;
  messageType: string;
  payload: T;
  subscribeActions(callback: (actionId: string, payload: Uint8Array | undefined) => void): VoidFunction;
};

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

      const result = await hostApi.chatCreateRoom(enumValue('v1', params));

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

      const result = await hostApi.chatRegisterBot(enumValue('v1', params));

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
      const result = await hostApi.chatPostMessage(enumValue('v1', { roomId, payload }));

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
    subscribeChatList(callback: (rooms: ChatRoom[]) => void) {
      return hostApi.chatListSubscribe(enumValue('v1', undefined), action => {
        if (action.tag === 'v1') {
          callback(action.value);
        }
      });
    },
    subscribeAction(callback: (action: ChatReceivedAction) => void) {
      return hostApi.chatActionSubscribe(enumValue('v1', undefined), action => {
        switch (action.tag) {
          case 'v1':
            callback(action.value);
            break;
          default:
            console.error(`Unknown message version ${action.tag}`);
        }
      });
    },

    onCustomMessageRenderingRequest(callback: ChatCustomMessageRenderer) {
      return transport.handleSubscription('product_chat_custom_message_render_subscribe', (params, send, interrupt) => {
        if (params.tag !== 'v1') {
          // unsupported version
          interrupt();
          return () => {
            /* empty */
          };
        }

        const { messageId, messageType, payload } = params.value;

        return callback(
          {
            messageId,
            messageType,
            payload,
            subscribeActions(callback) {
              const actionsSubscription = hostApi.chatActionSubscribe(enumValue('v1', undefined), action => {
                if (
                  action.tag === 'v1' &&
                  action.value.payload.tag === 'ActionTriggered' &&
                  action.value.payload.value.messageId === messageId
                ) {
                  callback(action.value.payload.value.actionId, action.value.payload.value.payload);
                }
              });

              return actionsSubscription.unsubscribe;
            },
          },
          node => send(enumValue('v1', node)),
        );
      });
    },
  };

  return chat;
};

export function matchChatCustomRenderers(map: Record<string, ChatCustomMessageRenderer>): ChatCustomMessageRenderer {
  return (params, render) => {
    const { messageType } = params;
    const renderer = map[messageType];

    if (!renderer) {
      throw new Error(`Renderer for message type ${messageType} is not defined`);
    }

    return renderer(params, render);
  };
}
