/**
 * Offline data preparation for Bulletin Chain (CID calculation, chunking, DAG building)
 */

import type { CID } from 'multiformats/cid';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { FixedSizeChunker } from './chunker.js';
import { UnixFsDagBuilder } from './dag.js';
import type { Chunk, ChunkerConfig, ClientConfig, StoreOptions } from './types.js';
import { BulletinError, CidCodec, DEFAULT_CHUNKER_CONFIG, DEFAULT_STORE_OPTIONS } from './types.js';
import { calculateCid, estimateAuthorization, toBulletinError } from './utils.js';

/**
 * Offline data preparer for Bulletin Chain
 *
 * Handles CID calculation, chunking, DAG-PB manifest creation, and
 * authorization estimation without any chain interaction.
 * Used internally by AsyncBulletinClient and MockBulletinClient.
 */
export class BulletinPreparer {
  private config: Required<ClientConfig>;

  constructor(config?: ClientConfig) {
    this.config = {
      defaultChunkSize: config?.defaultChunkSize ?? 1024 * 1024,
      createManifest: config?.createManifest ?? true,
      chunkingThreshold: config?.chunkingThreshold ?? 2 * 1024 * 1024,
    };
  }

  /**
   * Prepare a simple store operation (data < 2 MiB)
   *
   * Returns the data and its CID. Use PAPI to submit to TransactionStorage.store
   */
  prepareStore(data: Uint8Array, options?: StoreOptions): Result<{ data: Uint8Array; cid: CID }, BulletinError> {
    if (data.length === 0) {
      return err(new BulletinError('Data cannot be empty', 'EMPTY_DATA'));
    }

    if (data.length > this.config.chunkingThreshold) {
      return err(
        new BulletinError(
          `Data size ${data.length} exceeds single-transaction limit of ${this.config.chunkingThreshold} bytes. Use prepareStoreChunked() for large data.`,
          'DATA_TOO_LARGE',
        ),
      );
    }

    const opts = { ...DEFAULT_STORE_OPTIONS, ...options };

    const cidCodec = opts.cidCodec ?? CidCodec.Raw;
    const hashAlgorithm = opts.hashingAlgorithm ?? DEFAULT_STORE_OPTIONS.hashingAlgorithm;

    return calculateCid(data, cidCodec, hashAlgorithm).map(cid => ({ data, cid }));
  }

  /**
   * Prepare a chunked store operation for large files
   *
   * This chunks the data, calculates CIDs, and optionally creates a DAG-PB manifest.
   * Returns chunk data and manifest that can be submitted via PAPI.
   */
  prepareStoreChunked(
    data: Uint8Array,
    config?: Partial<ChunkerConfig>,
    options?: StoreOptions,
  ): Result<
    {
      chunks: Chunk[];
      manifest?: { data: Uint8Array; cid: CID };
    },
    BulletinError
  > {
    if (data.length === 0) {
      return err(new BulletinError('Data cannot be empty', 'EMPTY_DATA'));
    }

    const chunkerConfig: ChunkerConfig = {
      ...DEFAULT_CHUNKER_CONFIG,
      chunkSize: config?.chunkSize ?? this.config.defaultChunkSize,
      createManifest: config?.createManifest ?? this.config.createManifest,
    };

    const opts = { ...DEFAULT_STORE_OPTIONS, ...options };

    const hashAlgorithm = opts.hashingAlgorithm ?? DEFAULT_STORE_OPTIONS.hashingAlgorithm;

    // Create chunker — constructor may throw
    let chunker: FixedSizeChunker;
    try {
      chunker = new FixedSizeChunker(chunkerConfig);
    } catch (error) {
      return err(toBulletinError(error));
    }

    // Chunk the data
    return chunker.chunk(data).andThen(chunks => {
      // Calculate CIDs for each chunk (always Raw codec for chunks)
      for (const chunk of chunks) {
        const cidResult = calculateCid(chunk.data, CidCodec.Raw, hashAlgorithm);
        if (cidResult.isErr()) return err(cidResult.error);
        chunk.cid = cidResult.value;
      }

      // Optionally create manifest
      if (chunkerConfig.createManifest) {
        const builder = new UnixFsDagBuilder();
        return builder.build(chunks, hashAlgorithm).map(dagManifest => ({
          chunks,
          manifest: {
            data: dagManifest.dagBytes,
            cid: dagManifest.rootCid,
          },
        }));
      }

      return ok({ chunks, manifest: undefined });
    });
  }

  /**
   * Estimate authorization needed for storing data
   *
   * Returns (num_transactions, total_bytes) needed for authorization
   */
  estimateAuthorization(dataSize: number): {
    transactions: number;
    bytes: number;
  } {
    return estimateAuthorization(dataSize, this.config.defaultChunkSize, this.config.createManifest);
  }
}
