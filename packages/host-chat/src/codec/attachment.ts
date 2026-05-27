import { Enum } from '@novasamatech/scale';
import { Bytes, Option, Struct, str, u32 } from 'scale-ts';

// UTF-8 bytes of a Wolt-spec blurhash string (componentX=4, componentY=3).
// Wire type is Vec<u8>; the bytes themselves are the ASCII blurhash.
export const MediaThumbnail = Bytes();

export const GeneralFileMeta = Struct({
  mimeType: str,
  fileSize: u32,
});

export const ImageFileMeta = Struct({
  general: GeneralFileMeta,
  width: u32,
  height: u32,
  thumbnail: Option(MediaThumbnail),
});

export const VideoFileMeta = Struct({
  general: GeneralFileMeta,
  duration: u32,
  thumbnail: Option(MediaThumbnail),
});

export const FileMeta = Enum({
  general: GeneralFileMeta,
  image: ImageFileMeta,
  video: VideoFileMeta,
});

// Hop node endpoint stamped onto outgoing attachments so the receiver can validate
// the URL against its bulletin-chain hop allowlist before opening a socket.
export const NodeEndpoint = Enum({
  wssUrl: Struct({ url: str }),
});

export const P2PMixnetFile = Struct({
  identifier: Bytes(),
  claimTicket: Bytes(),
  nodeEndpoint: NodeEndpoint,
  meta: FileMeta,
});

export const FileVariant = Enum({
  p2pMixnet: P2PMixnetFile,
});
