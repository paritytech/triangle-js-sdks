import { Enum, ErrEnum, Status } from '@novasamatech/scale';
import { Bytes, Option, Result, Struct, Vector, _void, str, u64 } from 'scale-ts';

import { GenericErr } from '../commonCodecs.js';

// room registration

export const ChatRoomRegistrationErr = ErrEnum('ChatRoomRegistrationErr', {
  PermissionDenied: [_void, 'Permission denied'],
  Unknown: [GenericErr, 'Unknown error while chat registration'],
});

export const ChatRoomRequest = Struct({
  roomId: str,
  name: str,
  icon: str, // URL or base64-encoded image for contact
});

export const ChatRoomRegistrationStatus = Status('New', 'Exists');

export const ChatRoomRegistrationResult = Struct({
  status: ChatRoomRegistrationStatus,
});

export const ChatCreateRoomV1_request = ChatRoomRequest;
export const ChatCreateRoomV1_response = Result(ChatRoomRegistrationResult, ChatRoomRegistrationErr);

// register as a bot

export const ChatBotRegistrationErr = ErrEnum('ChatBotRegistrationErr', {
  PermissionDenied: [_void, 'Permission denied'],
  Unknown: [GenericErr, 'Unknown error while chat registration'],
});

export const ChatBotRequest = Struct({
  botId: str,
  name: str,
  icon: str, // URL or base64-encoded image for contact
});

export const ChatBotRegistrationStatus = Status('New', 'Exists');

export const ChatBotRegistrationResult = Struct({
  status: ChatBotRegistrationStatus,
});

export const ChatRegisterBotV1_request = ChatBotRequest;
export const ChatRegisterBotV1_response = Result(ChatBotRegistrationResult, ChatBotRegistrationErr);

// receiving rooms

export const ChatRoomParticipation = Status('RoomHost', 'Bot');

export const ChatRoom = Struct({
  roomId: str,
  participatingAs: ChatRoomParticipation,
});

export const ChatListSubscribeV1_start = _void;
export const ChatListSubscribeV1_receive = Vector(ChatRoom);

// message format

export const ChatAction = Struct({
  actionId: str,
  title: str,
});

export const ChatActionLayout = Status('Column', 'Grid');

export const ChatActions = Struct({
  text: Option(str),
  actions: Vector(ChatAction),
  layout: ChatActionLayout,
});

export const ChatMedia = Struct({
  url: str,
});

export const ChatRichText = Struct({
  text: Option(str),
  media: Vector(ChatMedia),
});

export const ChatFile = Struct({
  url: str,
  fileName: str,
  mimeType: str,
  sizeBytes: u64,
  text: Option(str),
});

export const ChatReaction = Struct({
  messageId: str,
  emoji: str,
});

export const ChatMessageContent = Enum({
  Text: str,
  RichText: ChatRichText,
  Actions: ChatActions,
  File: ChatFile,
  Reaction: ChatReaction,
  ReactionRemoved: ChatReaction,
});

// sending message

export const ChatMessagePostingErr = ErrEnum('ChatMessagePostingErr', {
  MessageTooLarge: [_void, 'ChatMessagePosting: message too large'],
  Unknown: [GenericErr, 'ChatMessagePosting: unknown error'],
});

export const ChatPostMessageResult = Struct({
  messageId: str,
});

export const ChatPostMessageV1_request = Struct({
  roomId: str,
  payload: ChatMessageContent,
});
export const ChatPostMessageV1_response = Result(ChatPostMessageResult, ChatMessagePostingErr);

// receiving a message

export const ActionTrigger = Struct({
  messageId: str,
  actionId: str,
  payload: Option(Bytes()),
});

export const ChatCommand = Struct({
  command: str,
  payload: str,
});

export const ChatActionPayload = Enum({
  MessagePosted: ChatMessageContent,
  ActionTriggered: ActionTrigger,
  Command: ChatCommand,
});

export const ReceivedChatAction = Struct({
  roomId: str,
  peer: str,
  payload: ChatActionPayload,
});

export const ChatActionSubscribeV1_start = _void;
export const ChatActionSubscribeV1_receive = ReceivedChatAction;
