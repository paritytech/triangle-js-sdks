import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const wasmJs = join(packageRoot, 'dist/nodejs/substrate_slot_sr25519_wasm.js');

const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { cwd: packageRoot, stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

if (!existsSync(wasmJs)) {
  run('wasm-pack', ['build', 'rust', '--release', '--target', 'web', '--out-dir', '../dist/nodejs']);
}

run('node', ['scripts/link-nodejs.mjs']);
run('npm', ['run', 'build:ts']);
