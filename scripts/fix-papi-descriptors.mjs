// polkadot-api >= 2 emits extension-less relative specifiers in the descriptor `.d.ts`
// files (`from "./people_lite"`). The generated package is `"type": "module"`, so the
// repo's `moduleResolution: nodenext` refuses to resolve them and every re-export from
// `index.d.ts` silently resolves to nothing — `People_lite` and friends vanish. The
// descriptors checked in before polkadot-api 2.x carried the extensions, so this only
// bites on regeneration. Run after every `papi add`/`papi update`.
//
// ponytail: a regex over three import lines. Delete this and its npm script the day papi
// emits nodenext-resolvable output.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: fix-papi-descriptors.mjs <descriptors-dist-dir>');
  process.exit(1);
}

let patched = 0;

for (const file of readdirSync(dir).filter(name => name.endsWith('.d.ts'))) {
  const path = join(dir, file);
  const before = readFileSync(path, 'utf8');
  const after = before.replace(/(from ")(\.\/[^"]+)(")/g, (match, head, specifier, tail) =>
    specifier.endsWith('.js') ? match : `${head}${specifier}.js${tail}`,
  );

  if (after === before) continue;

  writeFileSync(path, after);
  patched += 1;
}

console.log(`fix-papi-descriptors: patched ${patched} file(s) in ${dir}`);
