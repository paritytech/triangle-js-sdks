import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(packageRoot, 'dist/nodejs');
const wasmGlueDir = join(packageRoot, 'wasm-glue');
const glueFiles = [
  'substrate_slot_sr25519_wasm.js',
  'substrate_slot_sr25519_wasm.d.ts',
  'substrate_slot_sr25519_wasm_bg.wasm',
  'substrate_slot_sr25519_wasm_bg.wasm.d.ts',
];

mkdirSync(wasmGlueDir, { recursive: true });

for (const file of glueFiles) {
  const source = join(distDir, file);

  if (!existsSync(source)) {
    console.error(`sync-wasm-glue: missing ${source} — run npm run build:wasm first`);
    process.exit(1);
  }

  copyFileSync(source, join(wasmGlueDir, file));
}

console.log('sync-wasm-glue: updated wasm-glue/ from dist/nodejs/');
