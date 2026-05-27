import { describe, expect, it } from 'vitest';

import {
  FileMeta,
  FileVariant,
  GeneralFileMeta,
  ImageFileMeta,
  NodeEndpoint,
  P2PMixnetFile,
  VideoFileMeta,
} from './attachment.js';

describe('attachment codecs', () => {
  describe('GeneralFileMeta', () => {
    it('round-trips', () => {
      const original = { mimeType: 'application/pdf', fileSize: 1024 };
      const encoded = GeneralFileMeta.enc(original);
      const decoded = GeneralFileMeta.dec(encoded);
      expect(decoded).toEqual(original);
    });
  });

  describe('ImageFileMeta', () => {
    it('round-trips without thumbnail', () => {
      const original = {
        general: { mimeType: 'image/jpeg', fileSize: 500_000 },
        width: 1920,
        height: 1080,
        thumbnail: undefined,
      };
      const encoded = ImageFileMeta.enc(original);
      const decoded = ImageFileMeta.dec(encoded);
      expect(decoded).toEqual(original);
    });

    it('round-trips with blurhash thumbnail', () => {
      const original = {
        general: { mimeType: 'image/jpeg', fileSize: 500_000 },
        width: 1920,
        height: 1080,
        thumbnail: new TextEncoder().encode('L6PZfSi_.AyE_3t7t7R**0o#DgR4'),
      };
      const encoded = ImageFileMeta.enc(original);
      const decoded = ImageFileMeta.dec(encoded);
      expect(decoded.thumbnail).toEqual(original.thumbnail);
    });
  });

  describe('VideoFileMeta', () => {
    it('round-trips without thumbnail', () => {
      const original = {
        general: { mimeType: 'video/mp4', fileSize: 10_000_000 },
        duration: 120,
        thumbnail: undefined,
      };
      const encoded = VideoFileMeta.enc(original);
      const decoded = VideoFileMeta.dec(encoded);
      expect(decoded).toEqual(original);
    });

    it('round-trips with blurhash thumbnail', () => {
      const original = {
        general: { mimeType: 'video/mp4', fileSize: 10_000_000 },
        duration: 120,
        thumbnail: new TextEncoder().encode('LKO2?U%2Tw=w]~RBVZRi};RPxuwH'),
      };
      const encoded = VideoFileMeta.enc(original);
      const decoded = VideoFileMeta.dec(encoded);
      expect(decoded.thumbnail).toEqual(original.thumbnail);
    });
  });

  describe('FileMeta', () => {
    it('round-trips all variants', () => {
      const variants = [
        { tag: 'general' as const, value: { mimeType: 'application/pdf', fileSize: 1024 } },
        {
          tag: 'image' as const,
          value: {
            general: { mimeType: 'image/png', fileSize: 2048 },
            width: 800,
            height: 600,
            thumbnail: undefined,
          },
        },
        {
          tag: 'video' as const,
          value: {
            general: { mimeType: 'video/mp4', fileSize: 4096 },
            duration: 60,
            thumbnail: new TextEncoder().encode('blurhashstring'),
          },
        },
      ];

      for (const original of variants) {
        const encoded = FileMeta.enc(original);
        const decoded = FileMeta.dec(encoded);
        expect(decoded).toEqual(original);
      }
    });
  });

  describe('NodeEndpoint', () => {
    it('round-trips wssUrl', () => {
      const original = { tag: 'wssUrl' as const, value: { url: 'wss://hop-a.example/chat' } };
      const encoded = NodeEndpoint.enc(original);
      const decoded = NodeEndpoint.dec(encoded);
      expect(decoded).toEqual(original);
    });
  });

  describe('P2PMixnetFile', () => {
    it('round-trips with nodeEndpoint and image thumbnail', () => {
      const original = {
        identifier: new Uint8Array(32).fill(0xaa),
        claimTicket: new Uint8Array(32).fill(0xbb),
        nodeEndpoint: { tag: 'wssUrl' as const, value: { url: 'wss://bulletin.example/hop' } },
        meta: {
          tag: 'image' as const,
          value: {
            general: { mimeType: 'image/jpeg', fileSize: 500_000 },
            width: 1920,
            height: 1080,
            thumbnail: new TextEncoder().encode('L6PZfSi_.AyE_3t7t7R**0o#DgR4'),
          },
        },
      };
      const encoded = P2PMixnetFile.enc(original);
      const decoded = P2PMixnetFile.dec(encoded);
      expect(decoded.identifier).toEqual(original.identifier);
      expect(decoded.claimTicket).toEqual(original.claimTicket);
      expect(decoded.nodeEndpoint).toEqual(original.nodeEndpoint);
      expect(decoded.meta).toEqual(original.meta);
    });
  });

  describe('FileVariant', () => {
    it('round-trips p2pMixnet variant', () => {
      const variant = {
        tag: 'p2pMixnet' as const,
        value: {
          identifier: new Uint8Array(32).fill(0x11),
          claimTicket: new Uint8Array(32).fill(0x22),
          nodeEndpoint: { tag: 'wssUrl' as const, value: { url: 'wss://hop.example/path' } },
          meta: { tag: 'general' as const, value: { mimeType: 'text/plain', fileSize: 10 } },
        },
      };
      const encoded = FileVariant.enc(variant);
      const decoded = FileVariant.dec(encoded);
      expect(decoded).toEqual(variant);
    });
  });
});
