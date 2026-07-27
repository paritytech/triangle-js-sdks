import { isAbsolute } from 'node:path';

import { default as react } from '@vitejs/plugin-react';
import { default as dts } from 'vite-plugin-dts';
import { default as wasm } from 'vite-plugin-wasm';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    hmr: false,
  },
  css: {
    modules: {
      generateScopedName: 'papp_[name]_[local]_[contenthash:base64:5]',
      hashPrefix: 'papp-ui',
    },
  },
  build: {
    rolldownOptions: {
      // Externalize every bare import (deps + peerDeps); only bundle relative/absolute source.
      external: id => !id.startsWith('.') && !isAbsolute(id),
      output: {
        preserveModules: true,
      },
    },
    lib: {
      name: 'host-papp-react-ui',
      entry: ['src/index.ts'],
      formats: ['es'],
      fileName: (_, entryName) => `${entryName}.js`,
      cssFileName: 'index',
    },
  },

  plugins: [
    react({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
    dts({}),
    // @ts-expect-error wasm module types are broken in our setup
    wasm(),
  ],
});
