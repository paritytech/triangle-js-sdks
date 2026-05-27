import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const result = spawnSync('npm', ['run', 'build:ts'], { cwd: packageRoot, stdio: 'inherit' });

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
