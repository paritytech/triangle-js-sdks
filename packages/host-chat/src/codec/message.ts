import { Enum, Hex, Nullable, Status } from '@novasamatech/scale';
import { Bytes, Option, Struct, Vector, _void, compact, str, u64 } from 'scale-ts';

import { FileVariant } from './attachment.js';

const AccountIdCodec = Bytes(32);
const PublicKeyCodec = Bytes(65);

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

// V2 multi-device roster mutations carried as chat-content variants.
// Android's `ChatMessageStatementContent.DeviceAdded`/`DeviceRemoved` use
// the `AccountId` / `EncodedPublicKey` wrapper types without `@FixedLength`,
// so substrate-sdk-android falls through to length-prefixed `Vec<u8>` on the
// wire. We accept that shape here (`Bytes()` = compact-length-prefixed bytes)
// instead of fixed-size to stay tolerant of Android's emitter. Other variants
// that use `@FixedLength` on raw `ByteArray` (e.g. `DeviceInfoContent` below)
// stay fixed-size and continue to use AccountIdCodec/PublicKeyCodec.
export const DeviceAddedContent = Struct({
  statementAccountId: Bytes(),
  encryptionPublicKey: Bytes(),
});

export const DeviceRemovedContent = Struct({
  statementAccountId: Bytes(),
});

// Legacy single-device accept (index 14, iOS V1). Wire: bare `String`.
// Superseded by `deviceChatAccepted` (index 20); keep for backward decode.
export const ChatAcceptedContent = Struct({
  messageId: str,
});

// Per-device descriptor for the multi-device accept. Matches iOS `Chat.PeerDevice`
// and Android `DeviceInfoScale`.
export const DeviceInfoContent = Struct({
  statementAccountId: AccountIdCodec,
  encryptionPublicKey: PublicKeyCodec,
});

// Multi-device accept (index 20, per chat spec v0.1
// https://hackmd.io/@1JCaGppGSUqHtJilikYaKw/Ski9naYdWe):
//   DeviceChatAccepted = { requestId: String, device: DeviceInfo }
// Sent via identity-level session SessionId(B, A) encrypted with K(A,B);
// identity-level encryption lets all of A's devices decrypt without per-device
// envelope. Index 19 is reserved (placeholder slot between deviceRemoved=18
// and deviceChatAccepted=20).
export const DeviceChatAcceptedContent = Struct({
  requestId: str,
  device: DeviceInfoContent,
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
  chatAccepted: ChatAcceptedContent, // 14 (legacy single-device accept, iOS V1)
  richText: RichTextContent, // 15
  _reserved16: _void, // 16 — reserved (android `coinagePayment`, unused on desktop)
  deviceAdded: DeviceAddedContent, // 17
  deviceRemoved: DeviceRemovedContent, // 18
  _reserved19: _void, // 19 — reserved (placeholder so deviceChatAccepted lands on the spec'd index 20)
  deviceChatAccepted: DeviceChatAcceptedContent, // 20 (multi-device accept, spec v0.1)
});

export const VersionedMessageContent = Enum({
  v1: MessageContent,
});

export const ChatMessage = Struct({
  messageId: str,
  timestamp: u64,
  versioned: VersionedMessageContent,
});
