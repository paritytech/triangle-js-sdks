import { defineConfig } from 'vite';
import { default as dts } from 'vite-plugin-dts';
import { externalizeDeps } from 'vite-plugin-externalize-deps';

export default defineConfig({
  // `base: './'` makes the emitted asset URL relative instead of server-absolute (`/...wasm`,
  // vite's default), which is what a published Node/ESM package needs.
  base: './',
  build: {
    minify: false,
    // Force the wasm to be emitted as a sibling asset file instead of base64-inlined.
    assetsInlineLimit: 0,
    // No HTML entry / preload polyfill — this is a library, not an app.
    modulePreload: false,
    rollupOptions: {
      input: 'src/index.ts',
      // Without `build.lib`, rollup treats the input as an app entry and tree-shakes the library
      // exports away. `preserveEntrySignatures: 'strict'` keeps the entry's export signature so
      // the public API survives.
      preserveEntrySignatures: 'strict',
      output: {
        format: 'es',
        entryFileNames: 'index.js',
        // Keep the wasm filename stable (no content hash) so it is predictable for consumers.
        assetFileNames: '[name][extname]',
      },
    },
  },
  plugins: [externalizeDeps(), dts({ include: ['src'] })],
});
