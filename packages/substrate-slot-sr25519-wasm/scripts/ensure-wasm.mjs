import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const wasmJs = join(packageRoot, 'dist/nodejs/substrate_slot_sr25519_wasm.js');
const wasmGlueDir = join(packageRoot, 'wasm-glue');
const glueFiles = [
  'substrate_slot_sr25519_wasm.js',
  'substrate_slot_sr25519_wasm.d.ts',
  'substrate_slot_sr25519_wasm_bg.wasm',
  'substrate_slot_sr25519_wasm_bg.wasm.d.ts',
];

const copyCommittedGlue = () => {
  const distDir = join(packageRoot, 'dist/nodejs');
  mkdirSync(distDir, { recursive: true });

  for (const file of glueFiles) {
    const source = join(wasmGlueDir, file);
    if (!existsSync(source)) {
      return false;
    }

    copyFileSync(source, join(distDir, file));
  }

  return true;
};

const runWasmPack = () => {
  const result = spawnSync(
    'wasm-pack',
    ['build', 'rust', '--release', '--target', 'web', '--out-dir', '../dist/nodejs'],
    { cwd: packageRoot, stdio: 'inherit' },
  );

  if (result.error?.code === 'ENOENT') {
    console.error(
      'substrate-slot-sr25519-wasm: wasm glue is missing, wasm-glue/ is incomplete, and wasm-pack is not installed.\n' +
        'Restore wasm-glue from git or install Rust + wasm-pack (https://rustwasm.github.io/wasm-pack/installer/) and run npm run build:wasm.',
    );
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

if (!existsSync(wasmJs)) {
  if (!copyCommittedGlue()) {
    runWasmPack();
  }
}
