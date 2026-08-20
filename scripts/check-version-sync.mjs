#!/usr/bin/env node
/**
 * Fail when `package-lock.json` disagrees with `package.json` about the extension version.
 *
 * The lockfile carries its own copy of the version in two places (the root object and the
 * `packages[""]` entry), and `npm install` only rewrites them when it runs — so a hand-edited or
 * scripted version bump leaves them behind silently. That drifted across 1.11.0, 1.12.0 and
 * 1.12.1 before anyone noticed, and `npm ci` had been installing a tree whose manifest disagreed
 * with the released build. The manifest version itself is derived (`manifest.config.ts` reads
 * `pkg.version`), so `package.json` is the single source of truth and this only guards the copies.
 *
 * Fix on failure: `npm install --package-lock-only`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const read = (name) => JSON.parse(readFileSync(join(repoRoot, name), 'utf8'));

const pkg = read('package.json');
const lock = read('package-lock.json');

const copies = [
  { where: 'package-lock.json → version', value: lock.version },
  { where: 'package-lock.json → packages[""].version', value: lock.packages?.['']?.version },
];

const drifted = copies.filter((copy) => copy.value !== pkg.version);

if (drifted.length > 0) {
  console.error(`Version drift: package.json is ${pkg.version}, but`);
  for (const copy of drifted) console.error(`  ${copy.where} is ${copy.value ?? '(missing)'}`);
  console.error('Run `npm install --package-lock-only` to resync.');
  process.exit(1);
}

console.log(`Version sync OK (${pkg.version}).`);
