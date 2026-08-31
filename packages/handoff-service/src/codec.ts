import { Bytes, Enum } from '@novasamatech/scale';
import { Struct, Vector, u64 } from 'scale-ts';

/**
 * Chunk list payload (RFC 0001): the root entry's reference to all chunks of an
 * uploaded file. Inside the versioned envelope it is preceded by two bytes
 * (version index, payload index) and is otherwise unchanged from the base spec.
 */
export const ChunkedFile = Struct({
  totalSize: u64,
  chunks: Vector(Bytes()),
});

/**
 * Legacy pool-stored metadata (base spec, pre RFC 0001): the same structure,
 * bare and unversioned. Aliased rather than re-declared so the byte-for-byte
 * identity RFC 0001's transition rule relies on cannot drift. Kept for decoding
 * root entries submitted before the versioned envelope existed.
 */
export const UploadedFile = ChunkedFile;

/**
 * Versioned root pool entry (RFC 0001). The blob whose encrypted hash is the
 * message `identifier`. `inline` carries the complete original file bytes —
 * for small files the root entry IS the file and no further pool reads exist.
 * The indices are normative (v1 -> 0; inline -> 0, chunked -> 1) and are pinned
 * positionally, so the wire format does not depend on declaration order.
 */
export const VersionedUploadedFile = Enum({ v1: Enum({ inline: Bytes(), chunked: ChunkedFile }, [0, 1]) }, [0]);

export type VersionedUploadedFilePayload =
  { kind: 'inline'; fileBytes: Uint8Array } | { kind: 'chunked'; totalSize: bigint; chunks: Uint8Array[] };

/**
 * Decode a root pool entry: versioned envelope first, then the bare legacy
 * layout (RFC 0001 transition rule — nothing in the message identifies the
 * format, and senders emitted legacy blobs before the envelope existed).
 */
export function decodeRootEntry(bytes: Uint8Array): VersionedUploadedFilePayload {
  const payload = decodeEnvelopePayload(bytes);

  if (payload === undefined) {
    return { kind: 'chunked', ...UploadedFile.dec(bytes) };
  }
  if (payload.tag === 'inline') {
    return { kind: 'inline', fileBytes: payload.value };
  }
  return { kind: 'chunked', ...payload.value };
}

/** `undefined` when the bytes are not a versioned envelope at all. */
function decodeEnvelopePayload(bytes: Uint8Array) {
  try {
    // Only v1 exists; scale-ts throws on unknown version and payload indices.
    return VersionedUploadedFile.dec(bytes).value;
  } catch {
    return undefined;
  }
}
