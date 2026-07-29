#!/usr/bin/env node
/**
 * Packs every workspace package into `local-tarballs/` so an external project can
 * consume this SDK before it is published to npm.
 *
 * Two problems make a plain `npm pack` insufficient here:
 *
 * 1. The packages depend on each other at exact versions (`"@novasamatech/host-api": "0.8.11"`).
 *    A consumer installing one tarball would resolve those siblings from the registry,
 *    where the version does not exist yet.
 * 2. npm keys `file:` dependencies by resolved version, so re-packing after a code change
 *    without bumping anything can leave a stale copy installed.
 *
 * Both are solved by stamping a unique prerelease version (`0.8.11-local.<timestamp>`)
 * into the packed manifests and rewriting the intra-repo dependency ranges to match.
 * The repo's own package.json files are never modified — patching happens on the
 * extracted tarball contents.
 *
 * Usage:
 *   npm run pack:local              # build, then pack
 *   npm run pack:local -- --skip-build
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const OUT_DIR = join(REPO_ROOT, 'local-tarballs');
const SCOPE = '@novasamatech/';

const skipBuild = process.argv.includes('--skip-build');

const run = (cmd, args, cwd = REPO_ROOT) =>
  execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });

/** `0.8.11` + a per-run stamp, so every pack resolves to a version npm has not seen. */
function localVersion(baseVersion) {
  const t = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `${baseVersion}-local.${t}`;
}

function readWorkspacePackages() {
  return readdirSync(PACKAGES_DIR)
    .map(dir => join(PACKAGES_DIR, dir, 'package.json'))
    .filter(existsSync)
    .map(manifestPath => ({ manifestPath, manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) }))
    .filter(({ manifest }) => manifest.name && !manifest.private);
}

const packages = readWorkspacePackages();
if (packages.length === 0) {
  console.error('No publishable packages found under packages/.');
  process.exit(1);
}

const baseVersion = packages[0].manifest.version;
const mismatched = packages.filter(p => p.manifest.version !== baseVersion);
if (mismatched.length > 0) {
  // Not fatal — each package keeps its own version, we only stamp the same suffix.
  console.warn(`! versions differ across packages (${mismatched.map(p => p.manifest.name).join(', ')})`);
}

const version = localVersion(baseVersion);
const localNames = new Set(packages.map(p => p.manifest.name));

/**
 * The stamp is part of the filename on purpose. npm keys a `file:` dependency by its
 * spec string, so a stable filename would let a plain `npm install` report "up to date"
 * and silently keep the previous build. A changing filename forces npm to re-resolve.
 * The cost is that consumers must re-copy the block from `consume.json` after each pack.
 */
const tarballName = name => `${name.replace('@', '').replace('/', '-')}-${version}.tgz`;

if (!skipBuild) {
  console.log('Building all packages…');
  execFileSync('npm', ['run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const staging = mkdtempSync(join(tmpdir(), 'triangle-pack-'));

try {
  console.log(`\nPacking ${packages.length} packages as ${version}…`);

  // `npm pack --workspaces` honours each package's `files` field and any prepack hooks.
  run('npm', ['pack', '--workspaces', '--pack-destination', staging]);

  for (const { manifest } of packages) {
    const { name } = manifest;
    const packed = readdirSync(staging).find(f => f.startsWith(`${name.replace('@', '').replace('/', '-')}-`));
    if (!packed) {
      throw new Error(`npm pack produced no tarball for ${name}`);
    }

    // Extract, patch the manifest, re-roll. The repo tree is left untouched.
    const workDir = join(staging, `x-${packed}`);
    mkdirSync(workDir, { recursive: true });
    run('tar', ['-xzf', join(staging, packed), '-C', workDir]);

    const innerManifestPath = join(workDir, 'package', 'package.json');
    const inner = JSON.parse(readFileSync(innerManifestPath, 'utf8'));
    inner.version = version;

    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      const deps = inner[field];
      if (!deps) continue;
      for (const dep of Object.keys(deps)) {
        if (dep.startsWith(SCOPE) && localNames.has(dep)) {
          deps[dep] = version;
        }
      }
    }

    writeFileSync(innerManifestPath, `${JSON.stringify(inner, null, 2)}\n`);
    run('tar', ['-czf', join(OUT_DIR, tarballName(name)), '-C', workDir, 'package']);
    console.log(`  ✓ ${tarballName(name)}`);
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}

// Emit a ready-to-paste consumer snippet. `overrides` is what actually forces every
// nested @novasamatech/* request onto the local tarball rather than the registry.
const fileSpec = name => `file:${join(OUT_DIR, tarballName(name))}`;
const overrides = Object.fromEntries(packages.map(p => [p.manifest.name, fileSpec(p.manifest.name)]).sort());

writeFileSync(
  join(OUT_DIR, 'consume.json'),
  `${JSON.stringify({ version, dependencies: overrides, overrides }, null, 2)}\n`,
);

console.log(`\nWrote ${packages.length} tarballs to ${OUT_DIR}`);
console.log(`Packed version: ${version}\n`);
console.log('In the consuming project, copy from:');
console.log(`  ${join(OUT_DIR, 'consume.json')}\n`);
console.log('  • from "dependencies": only the packages you actually import');
console.log('  • the whole "overrides" block, so transitive @novasamatech/* deps resolve locally');
console.log('\n…then run `npm install`.');
console.log('Tarball names carry the stamp, so re-copy both blocks after every pack —');
console.log('that is what makes a plain `npm install` pick up the new build.');
