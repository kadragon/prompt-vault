import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// A delegation trigger is stated in three places that cannot be collapsed into one,
// because each has a different reader:
//
//   docs/delegation.md          — the owner: the routing table a human or agent reads on demand
//   docs/workflows.md           — the `code` cycle narrative, read while executing a step
//   .claude/agents/{agent}.md   — the `description:` the Task tool actually matches on
//
// An agent routes off whichever it reads first, so a partial edit produces silently
// contradictory routing — which is exactly what happened while a fourth copy also lived
// in AGENTS.md. That copy is gone (AGENTS.md now points at docs/delegation.md), and this
// gate holds the remaining three together.
//
// The phrases below are NOT a fourth copy of the rules: they are the discriminating
// fragment of each trigger, and every one of them is asserted to still exist in the owning
// table too. Reword a trigger in the table and this goes red; reword it in one restatement
// and this goes red. Both are the point — the fix is to change all three plus this list.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Collapse whitespace (these phrases wrap across lines in prose and in YAML block
// scalars), fold case, and normalise typographic apostrophes so a smart-quote edit in
// one file does not read as a routing change.
const normalise = (text: string): string =>
  text.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').toLowerCase();

const read = (relativePath: string): string => normalise(readFileSync(join(repoRoot, relativePath), 'utf8'));

const OWNER = 'docs/delegation.md';
const WORKFLOW = 'docs/workflows.md';

type Role = { agent: string; phrases: string[] };

const ROLES: Role[] = [
  { agent: 'explorer', phrases: ["mapping a provider's live conversation dom", '>5 files'] },
  { agent: 'implementer', phrases: ['parallel/batch', '>5 files'] },
  { agent: 'qa-verifier', phrases: ['after any implementation', 'must not verify their own work'] },
  { agent: 'product-evaluator', phrases: ['web store release', 'user-visible ui'] },
];

describe('delegation routing stays consistent across its three statements', () => {
  const owner = read(OWNER);
  const workflow = read(WORKFLOW);

  for (const { agent, phrases } of ROLES) {
    describe(agent, () => {
      const description = read(join('.claude', 'agents', `${agent}.md`));

      // Named in all three at all — catches a role added or renamed in one place only.
      it('is named in the table, the workflow, and its own role file', () => {
        expect(owner).toContain(agent);
        expect(workflow).toContain(agent);
        expect(description).toContain(agent);
      });

      for (const phrase of phrases) {
        it(`states "${phrase}" in ${OWNER}`, () => {
          // The table owns the wording. If this fails the trigger was reworded at the
          // source: update the other two places and this list, do not delete the phrase.
          expect(owner).toContain(phrase);
        });

        it(`states "${phrase}" in ${WORKFLOW}`, () => {
          expect(workflow).toContain(phrase);
        });

        it(`states "${phrase}" in .claude/agents/${agent}.md`, () => {
          expect(description).toContain(phrase);
        });
      }
    });
  }

  // AGENTS.md is always-loaded and deliberately keeps exactly ONE routing phrase — the
  // generator-is-not-evaluator rule, which is never conditional and so is worth the load
  // cost. Everything else there must be a pointer.
  const AGENTS_MD_KEEPS = 'must not verify their own work';

  it('keeps AGENTS.md pointing at the table instead of restating it', () => {
    // The removed fourth copy is the failure this gate exists for: a re-added trigger list
    // in the always-loaded file is the copy most likely to drift unnoticed.
    const agentsMd = read('AGENTS.md');
    expect(agentsMd).toContain('docs/delegation.md');
    for (const { phrases } of ROLES) {
      for (const phrase of phrases) {
        if (phrase === AGENTS_MD_KEEPS) continue;
        expect(agentsMd).not.toContain(phrase);
      }
    }
  });

  it('keeps AGENTS.md\'s one retained rule worded like the table', () => {
    // The exemption above is not a licence to drift: the retained sentence must still
    // read the same as the owner's, or the always-loaded file contradicts the table.
    expect(read('AGENTS.md')).toContain(AGENTS_MD_KEEPS);
    expect(owner).toContain(AGENTS_MD_KEEPS);
  });
});
