import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/browser/host-runtime.ts'],
  bundle: true,
  format: 'iife',
  globalName: '__testHostRuntime',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/host-bundle.js',
  minify: true,
  sourcemap: false,
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  // polkadot WASM crypto needs this
  conditions: ['browser'],
});

console.log('Browser bundle built: dist/host-bundle.js');
