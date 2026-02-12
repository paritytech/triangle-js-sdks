import { Enum, Hex, Nullable, Status } from '@novasamatech/scale';
import { Option, Struct, Vector, _void, compact, str, u64 } from 'scale-ts';

export const TextContent = str;

export const Media = Struct({
  imageRemoteUrl: str,
});

export const RichTextContent = Struct({
  text: Option(TextContent), // markdown content
  media: Option(Vector(Media)),
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

// Note: important to use correct scale indexes
export const MessageContent = Enum({
  text: TextContent,
  token: TokenContent,
  send: SendContent,
  contactAdded: _void,
  reacted: ReactionContent,
  reactionRemoved: ReactionContent,
  richText: RichTextContent,
  reply: ReplyContent,
  callOffer: _void, // TBD
  callAnswer: _void, // TBD
  callCandidate: _void, // TBD
  callEnded: _void, // TBD
  edit: EditContent,
  leftChat: _void,
});

export const VersionedMessageContent = Enum({
  v1: MessageContent,
});

export const ChatMessage = Struct({
  messageId: str,
  timestamp: u64,
  versioned: VersionedMessageContent,
});
