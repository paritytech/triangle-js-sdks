import { Enum } from '@novasamatech/scale';
import { Bytes, Struct, str, u32 } from 'scale-ts';

export const GeneralFileMeta = Struct({
  mimeType: str,
  fileSize: u32,
});

export const ImageFileMeta = Struct({
  general: GeneralFileMeta,
  width: u32,
  height: u32,
});

export const VideoFileMeta = Struct({
  general: GeneralFileMeta,
  duration: u32,
});

export const FileMeta = Enum({
  general: GeneralFileMeta,
  image: ImageFileMeta,
  video: VideoFileMeta,
});

export const P2PMixnetFile = Struct({
  identifier: Bytes(),
  claimTicket: Bytes(),
  meta: FileMeta,
});

export const FileVariant = Enum({
  p2pMixnet: P2PMixnetFile,
});
