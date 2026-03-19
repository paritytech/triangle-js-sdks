import type { StorageAdapter } from '@novasamatech/storage-adapter';
import { createClient } from 'polkadot-api';

type ClientOptions = NonNullable<Parameters<typeof createClient>[1]>;

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export type MetadataCache = {
  forChain(chainId: string): ClientOptions;
  clear(chainId: string): Promise<void>;
  clearAll(): Promise<void>;
};

export const createMetadataCache = (options?: { storage?: StorageAdapter }): MetadataCache => {
  const memory = new Map<string, Uint8Array>();
  const knownKeys = new Set<string>();
  const storage = options?.storage;

  const cacheKey = (chainId: string, key: string) => `${chainId}:${key}`;

  return {
    forChain(chainId) {
      return {
        async getMetadata(key) {
          const k = cacheKey(chainId, key);

          const cached = memory.get(k);
          if (cached) return cached;

          if (storage) {
            const result = await storage.read(k);
            if (result.isOk() && result.value) {
              const bytes = base64ToBytes(result.value);
              memory.set(k, bytes);
              knownKeys.add(k);
              return bytes;
            }
          }

          return null;
        },
        setMetadata(key, metadata) {
          const k = cacheKey(chainId, key);
          memory.set(k, metadata);
          knownKeys.add(k);
          storage?.write(k, bytesToBase64(metadata));
        },
      };
    },

    async clear(chainId) {
      const prefix = `${chainId}:`;
      for (const key of [...knownKeys]) {
        if (key.startsWith(prefix)) {
          memory.delete(key);
          knownKeys.delete(key);
          if (storage) await storage.clear(key);
        }
      }
    },

    async clearAll() {
      if (storage) {
        for (const key of knownKeys) {
          await storage.clear(key);
        }
      }
      memory.clear();
      knownKeys.clear();
    },
  };
};
