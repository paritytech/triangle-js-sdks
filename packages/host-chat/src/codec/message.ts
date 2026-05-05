import { Enum, Hex, Nullable, Status } from '@novasamatech/scale';
import { Option, Struct, Vector, _void, compact, str, u64 } from 'scale-ts';

import { FileVariant } from './attachment.js';

export const TextContent = str;

export const RichTextContent = Struct({
  text: Option(TextContent),
  attachments: Option(Vector(FileVariant)),
});

export const Platform = Status('Android', 'iOS');

export const TokenContent = Struct({
  token: Hex(),
  platform: Platform,
});

export const SendContent = Struct({
  amount: compact,
  assetId: Nullable(str), // 0x scale encoded assetId or number, null for native
  blockHash: Hex(32), // fixed 32 byte array
  extrinsicHash: Hex(32), // fixed 32 byte array
});

export const ReactionContent = Struct({
  messageId: str, // encoded as string
  emoji: str,
});

export const ReplyContent = Struct({
  messageId: str,
  ownContent: RichTextContent,
});

export const EditContent = Struct({
  messageId: str,
  newContent: RichTextContent,
});

// Note: enum indices MUST match iOS/Android SCALE codecs.
// Indices are auto-assigned sequentially, so order matters.
export const MessageContent = Enum({
  text: TextContent, // 0
  token: TokenContent, // 1
  send: SendContent, // 2
  contactAdded: _void, // 3
  reacted: ReactionContent, // 4
  reactionRemoved: ReactionContent, // 5
  _reserved6: _void, // 6 — reserved (unused)
  reply: ReplyContent, // 7
  dataChannelOffer: _void, // 8
  dataChannelAnswer: _void, // 9
  dataChannelCandidates: _void, // 10
  _reserved11: _void, // 11 — reserved (unused)
  edit: EditContent, // 12
  leftChat: _void, // 13
  chatAccepted: _void, // 14
  richText: RichTextContent, // 15
});

export const VersionedMessageContent = Enum({
  v1: MessageContent,
});

export const ChatMessage = Struct({
  messageId: str,
  timestamp: u64,
  versioned: VersionedMessageContent,
});
