import { symlink } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const linkPath = join(packageRoot, 'src/nodejs');
await rm(linkPath, { recursive: true, force: true });
await new Promise((resolve, reject) => {
  symlink('../dist/nodejs', linkPath, 'dir', err => (err ? reject(err) : resolve()));
});
