// polkadot-api >= 2 emits extension-less relative specifiers in the descriptor `.d.ts`
// files, which `moduleResolution: nodenext` refuses to resolve — every re-export from
// `index.d.ts` then silently resolves to nothing. Run after `papi add` / `papi update`.
//
// The verify pass exists because `skipLibCheck` is on repo-wide: without it, a papi
// version that outruns this regex degrades the types with no error anywhere.
//
// ponytail: delete this and its npm script the day papi emits resolvable output.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Both quote styles: papi emits `from "./people_lite"` and `from './common-types'`.
const RELATIVE_SPECIFIER = /\bfrom (['"])(\.\.?\/[^'"]+?)\1/g;

const dir = process.argv[2];
if (!dir) {
  console.error('usage: fix-papi-descriptors.mjs <descriptors-dist-dir>');
  process.exit(1);
}

const files = readdirSync(dir).filter(name => name.endsWith('.d.ts'));
let patched = 0;

for (const file of files) {
  const path = join(dir, file);
  const before = readFileSync(path, 'utf8');
  const after = before.replace(RELATIVE_SPECIFIER, (match, quote, specifier) =>
    specifier.endsWith('.js') ? match : `from ${quote}${specifier}.js${quote}`,
  );

  if (after === before) continue;

  writeFileSync(path, after);
  patched += 1;
}

const unresolved = files.flatMap(file => {
  const contents = readFileSync(join(dir, file), 'utf8');

  return [...contents.matchAll(RELATIVE_SPECIFIER)]
    .filter(([, , specifier]) => !specifier.endsWith('.js'))
    .map(([, , specifier]) => `${file}: ${specifier}`);
});

if (unresolved.length > 0) {
  console.error(`fix-papi-descriptors: extension-less specifiers survived in ${dir}:`);
  for (const entry of unresolved) console.error(`  ${entry}`);
  process.exit(1);
}

console.log(`fix-papi-descriptors: patched ${patched} file(s) in ${dir}`);
