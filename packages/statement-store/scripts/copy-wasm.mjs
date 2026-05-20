import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(packageRoot, 'src/wasm-substrate-sr25519');
const target = join(packageRoot, 'dist/wasm-substrate-sr25519');

mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
