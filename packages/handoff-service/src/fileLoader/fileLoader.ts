import { blake2b } from '@noble/hashes/blake2.js';
import { mergeUint8 } from '@polkadot-api/utils';
import type { ResultAsync } from 'neverthrow';
import { errAsync, okAsync } from 'neverthrow';

import { UploadedFile } from '../codec.js';
import {
  createFileEncryption,
  deriveEncryptionKey,
  derivePublicKey,
  generateTicket,
  signWithTicket,
} from '../crypto/index.js';
import type { HopClient } from '../rpc/index.js';

const DEFAULT_CHUNK_SIZE = 2_000_000;

function hash256(data: Uint8Array): Uint8Array {
  return blake2b(data, { dkLen: 32 });
}

function splitIntoChunks(data: Uint8Array, chunkSize: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    chunks.push(data.subarray(offset, offset + chunkSize));
  }
  return chunks;
}

export type UploadParams = {
  data: Uint8Array;
  hopClient: HopClient;
  chunkSize?: number;
  onProgress?: (sent: number, total: number) => void;
};

export type UploadResult = {
  identifier: Uint8Array;
  claimTicket: Uint8Array;
};

export function uploadFile(params: UploadParams): ResultAsync<UploadResult, Error> {
  const { data, hopClient, chunkSize = DEFAULT_CHUNK_SIZE, onProgress } = params;

  const ticket = generateTicket();
  const recipientPublicKey = derivePublicKey(ticket);
  const encryptionKey = deriveEncryptionKey(ticket);
  const encryption = createFileEncryption(encryptionKey);
  const recipients = [recipientPublicKey];

  const chunks = splitIntoChunks(data, chunkSize);
  const totalChunks = chunks.length;

  let result: ResultAsync<Uint8Array[], Error> = okAsync([]);

  for (let i = 0; i < totalChunks; i++) {
    const chunk = chunks[i]!;
    result = result.andThen(hashes => {
      const encrypted = encryption.encrypt(chunk);
      return hopClient.submit(encrypted, recipients).map(_poolStatus => {
        const chunkHash = hash256(encrypted);
        onProgress?.(i + 1, totalChunks + 1); // +1 for metadata
        return [...hashes, chunkHash];
      });
    });
  }

  return result.andThen(chunkHashes => {
    const metadata = UploadedFile.enc({
      totalSize: BigInt(data.length),
      chunks: chunkHashes,
    });

    const encryptedMetadata = encryption.encrypt(metadata);

    return hopClient.submit(encryptedMetadata, recipients).map(_poolStatus => {
      const metadataHash = hash256(encryptedMetadata);
      onProgress?.(totalChunks + 1, totalChunks + 1);
      return { identifier: metadataHash, claimTicket: ticket };
    });
  });
}

export type DownloadParams = {
  identifier: Uint8Array;
  claimTicket: Uint8Array;
  hopClient: HopClient;
  onProgress?: (received: number, total: number) => void;
};

export function downloadFile(params: DownloadParams): ResultAsync<Uint8Array, Error> {
  const { identifier, claimTicket, hopClient, onProgress } = params;

  const encryptionKey = deriveEncryptionKey(claimTicket);
  const encryption = createFileEncryption(encryptionKey);

  const metadataSignature = signWithTicket(claimTicket, identifier);

  return hopClient
    .claim(identifier, metadataSignature)
    .andThen(encryptedMetadata => {
      try {
        const metadataBytes = encryption.decrypt(encryptedMetadata);
        const uploadedFile = UploadedFile.dec(metadataBytes);
        return okAsync(uploadedFile);
      } catch (e) {
        return errAsync(new Error(`Failed to decrypt/decode metadata: ${e}`));
      }
    })
    .andThen(uploadedFile => {
      const { totalSize, chunks: chunkHashes } = uploadedFile;
      const totalChunks = chunkHashes.length;

      let result: ResultAsync<Uint8Array[], Error> = okAsync([]);

      for (let i = 0; i < totalChunks; i++) {
        const chunkHash = chunkHashes[i]!;
        result = result.andThen(decryptedChunks => {
          const chunkSignature = signWithTicket(claimTicket, chunkHash);

          return hopClient.claim(chunkHash, chunkSignature).andThen(encryptedChunk => {
            try {
              const chunk = encryption.decrypt(encryptedChunk);
              onProgress?.(i + 1, totalChunks);
              return okAsync([...decryptedChunks, chunk]);
            } catch (e) {
              return errAsync(new Error(`Failed to decrypt chunk ${i}: ${e}`));
            }
          });
        });
      }

      return result.andThen(decryptedChunks => {
        const reassembled = mergeUint8(decryptedChunks);

        if (BigInt(reassembled.length) !== totalSize) {
          return errAsync(new Error(`File size mismatch: expected ${totalSize}, got ${reassembled.length}`));
        }

        return okAsync(reassembled);
      });
    });
}
