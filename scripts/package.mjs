// Package the built extension into a Chrome Web Store upload zip.
//
// The store expects a zip whose ROOT is the extension root (manifest.json at the
// top level), so we zip the *contents* of dist/, not the dist/ folder itself.
// Runs `vite build` first so the zip always reflects current source; pass
// --no-build to zip an existing dist/ as-is.
//
// Output: prompt-vault-v{version}.zip in the repo root (gitignored via *.zip).
// Uses the system `zip` CLI (present on macOS and ubuntu-latest) — no runtime dep.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const zipName = `prompt-vault-v${version}.zip`;
const zipPath = join(root, zipName);

const skipBuild = process.argv.includes('--no-build');

function run(cmd, args, opts) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

// Fail loud if the system `zip` is missing rather than producing no artifact.
try {
  execFileSync('zip', ['-v'], { stdio: 'ignore' });
} catch {
  console.error(
    'error: the `zip` CLI is required to package the extension but was not found on PATH.\n' +
      '  macOS/Linux ship it by default; install it (e.g. `apt-get install zip`) and retry.',
  );
  process.exit(1);
}

if (!skipBuild) {
  console.log('› building extension (vite build)…');
  // On Windows npm is a `npm.cmd` shim; execFileSync won't resolve it without the
  // extension (or shell:true), so pick the platform-correct binary name.
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  run(npm, ['run', 'build'], { cwd: root });
}

const manifestPath = join(dist, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(
    `error: ${join('dist', 'manifest.json')} not found — run \`npm run build\` first ` +
      '(or drop --no-build).',
  );
  process.exit(1);
}

// Guard against shipping a mislabeled artifact: with --no-build, a stale dist/ can
// carry an older manifest version than package.json, so the zip name (derived from
// package.json) would not match the manifest inside it. Fail loud instead.
const distVersion = JSON.parse(readFileSync(manifestPath, 'utf8')).version;
if (distVersion !== version) {
  console.error(
    `error: dist/manifest.json version (${distVersion}) does not match package.json ` +
      `(${version}). The build is stale — run \`npm run build\` (drop --no-build) to refresh dist/.`,
  );
  process.exit(1);
}

// Overwrite any prior zip for this version so the artifact is never stale.
if (existsSync(zipPath)) rmSync(zipPath);

// -r recurse, -X strip extra OS metadata, -9 max compression. cwd=dist so paths
// are relative to the extension root. Exclude macOS cruft that can trip review —
// the globs match at any depth (a literal `.DS_Store` would only catch a top-level one).
console.log(`› zipping dist/ → ${zipName}…`);
run('zip', ['-r', '-X', '-9', zipPath, '.', '-x', '*.DS_Store', '-x', '*/__MACOSX/*'], {
  cwd: dist,
});

console.log(`\n✓ ${zipName} ready — upload this at the Chrome Web Store Developer Dashboard.`);
