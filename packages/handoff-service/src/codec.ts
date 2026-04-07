import { Bytes, Struct, Vector, u64 } from 'scale-ts';

/**
 * Internal metadata stored in the HOP pool that references all chunks of an uploaded file.
 * This is not part of the chat message — it's only used by the file loader.
 */
export const UploadedFile = Struct({
  totalSize: u64,
  chunks: Vector(Bytes()),
});
