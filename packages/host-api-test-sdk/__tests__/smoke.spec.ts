import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TestHostServer } from '../dist/index.js';
import { createTestHostServer } from '../dist/index.js';

describe('host-api-test-sdk smoke', () => {
  let server: TestHostServer;
  let html: string;

  beforeAll(async () => {
    server = await createTestHostServer({
      productUrl: 'http://localhost:3001',
      accounts: ['alice', 'bob'],
    });

    const res = await fetch(server.url);
    expect(res.status).toBe(200);
    html = await res.text();
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  });

  it('has iframe with correct sandbox attributes', () => {
    expect(html).toContain('id="product-frame"');
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-forms allow-popups"');
  });

  it('has config with correct structure', () => {
    expect(html).toContain('__TEST_HOST_CONFIG__');
    const configMatch = html.match(/window\.__TEST_HOST_CONFIG__\s*=\s*({.*?});/);
    expect(configMatch).not.toBeNull();
    const config = JSON.parse(configMatch![1]);
    expect(config).toHaveProperty('productUrl', 'http://localhost:3001');
    expect(config).toHaveProperty('accounts');
    expect(config).toHaveProperty('chain');
  });

  it('has product URL', () => {
    expect(html).toContain('http://localhost:3001');
  });

  it('has Alice account with correct URI', () => {
    const configMatch = html.match(/window\.__TEST_HOST_CONFIG__\s*=\s*({.*?});/);
    const config = JSON.parse(configMatch![1]);
    expect(config.accounts).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Alice', uri: '//Alice' })]),
    );
  });

  it('has Bob account with correct URI', () => {
    const configMatch = html.match(/window\.__TEST_HOST_CONFIG__\s*=\s*({.*?});/);
    const config = JSON.parse(configMatch![1]);
    expect(config.accounts).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Bob', uri: '//Bob' })]));
  });

  it('has bundle script with substantial size', () => {
    expect(html).toContain('<script>');
    expect(html.length).toBeGreaterThan(10000);
  });

  it('has test-host API', () => {
    expect(html).toContain('__TEST_HOST__');
  });
});
