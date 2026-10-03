import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

// Two catalog descriptions tell translators their key never renders: it is thrown only by a
// post-batch return hook, and the bulk driver swallows that rejection with console.warn
// (src/content/mount.ts, `driveBulkPanel`). That is a claim about call sites, so pin the call
// sites — a forward-path caller reusing either hook would put the key in the bulk summary
// while its description still says nobody reads it.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLAUDE_ADAPTER = 'src/adapters/claude/index.ts';

const CONSOLE_ONLY: ReadonlyArray<{ constant: string; hook: string }> = [
  { constant: 'ERR_CLAUDE_PROJECT_HOME_MISMATCH', hook: 'openProjectHome' },
  { constant: 'ERR_CLAUDE_NOT_RECENTS_PAGE', hook: 'openRecentsHome' },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [relative(REPO_ROOT, path).split(sep).join('/')] : [];
  });
}

const SOURCES = new Map(sourceFiles(join(REPO_ROOT, 'src')).map((file) => [file, readFileSync(join(REPO_ROOT, file), 'utf8')]));

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}(`);
  expect(start, `${name} is defined in ${CLAUDE_ADAPTER}`).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf('\n}\n', start));
}

describe('console-only error keys', () => {
  for (const { constant, hook } of CONSOLE_ONLY) {
    it(`${constant} is thrown only inside the Claude ${hook} return hook`, () => {
      const uses = [...SOURCES].flatMap(([file, source]) =>
        source
          .split('\n')
          .filter((line) => new RegExp(`\\b${constant}\\b`).test(line))
          .filter((line) => !/^\s*export const /.test(line) && line.trim() !== `${constant},`)
          .map((line) => ({ file, line: line.trim() })),
      );
      expect(uses).toEqual([{ file: CLAUDE_ADAPTER, line: `throw new ExtractionError(${constant});` }]);
      expect(functionBody(SOURCES.get(CLAUDE_ADAPTER)!, hook)).toContain(`throw new ExtractionError(${constant})`);
    });

    it(`${hook} is called only as the bulk driver's returnToStart`, () => {
      const calls = [...SOURCES].flatMap(([file, source]) =>
        source
          .split('\n')
          .filter((line) => new RegExp(`\\b${hook}\\??\\.?\\(`).test(line))
          .filter((line) => !line.includes(`async function ${hook}(`))
          .map((line) => ({ file, line: line.trim() })),
      );
      // ChatGPT has a same-named hook it also calls internally; only the Claude adapter's
      // own calls and the shared driver's could reach the Claude keys.
      const relevant = calls.filter(({ file }) => file === CLAUDE_ADAPTER || file === 'src/content/mount.ts');
      expect(relevant.length).toBeGreaterThan(0);
      for (const call of relevant) {
        expect(call.file).toBe('src/content/mount.ts');
        expect(call.line).toMatch(/^returnToStart: /);
      }
    });
  }
});
