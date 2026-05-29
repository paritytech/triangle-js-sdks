import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
// `build:wasm` runs wasm-pack with `--out-dir ../.wasm-glue-build`; we copy the 4 glue files we
// care about into the committed `wasm-glue/`, leaving wasm-pack's package.json/.gitignore/README
// behind in the throwaway build dir.
const buildDir = join(packageRoot, '.wasm-build');
const wasmGlueDir = join(packageRoot, 'wasm');
const glueFiles = [
  'substrate_slot_sr25519_wasm.js',
  'substrate_slot_sr25519_wasm.d.ts',
  'substrate_slot_sr25519_wasm_bg.wasm',
  'substrate_slot_sr25519_wasm_bg.wasm.d.ts',
];

mkdirSync(wasmGlueDir, { recursive: true });

for (const file of glueFiles) {
  const source = join(buildDir, file);

  if (!existsSync(source)) {
    console.error(`sync-wasm: missing ${source} — run npm run build:wasm first`);
    process.exit(1);
  }

  copyFileSync(source, join(wasmGlueDir, file));
}

console.log('sync-wasm : updated wasm/ from .wasm-glue-build/');
