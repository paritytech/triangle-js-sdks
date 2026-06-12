import { defineConfig } from 'vite';
import { default as dts } from 'vite-plugin-dts';
import { externalizeDeps } from 'vite-plugin-externalize-deps';

export default defineConfig({
  build: {
    minify: false,
    // Library mode emits a single self-contained ESM file with the wasm inlined as a `data:` URL
    // (no sibling asset, no `__vitePreload`), so consumers don't depend on any vite runtime globals.
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
  },
  plugins: [externalizeDeps(), dts({ include: ['src'], exclude: ['**/*.spec.ts'] })],
});
