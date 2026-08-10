import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { claudeAdapter } from '../../../src/adapters/claude';
import { ExtractionError } from '../../../src/core/errors';

// Passing a non-global document is what makes the adapter take the one-shot snapshot
// path instead of the live scroll walk (which `collect-virtualized.test.ts` covers).
function docFrom(html: string): Document {
  const window = new Window();
  window.document.write(html);
  return window.document as unknown as Document;
}

function loadFixture(name: string): Document {
  const path = fileURLToPath(new URL(`../../fixtures/claude/${name}`, import.meta.url));
  return docFrom(readFileSync(path, 'utf-8'));
}

describe('claudeAdapter.extract', () => {
  it('stamps the provider and the title, stripping Claude’s document-title suffix', async () => {
    const convo = await claudeAdapter.extract(loadFixture('short.html'));
    expect(convo.provider).toBe('claude');
    // document.title is "Fixture conversation - Claude" (live format verified 2026-07-25).
    expect(convo.title).toBe('Fixture conversation');
  });

  it('falls back to a generic title when the page has no conversation title yet', async () => {
    const convo = await claudeAdapter.extract(
      docFrom(
        '<html><head><title>Claude</title></head><body>' +
          '<div data-index="0"><div class="standard-markdown"><p>hi</p></div></div>' +
          '</body></html>',
      ),
    );
    expect(convo.title).toBe('Claude conversation');
  });

  it('reads both roles in on-screen order', async () => {
    const convo = await claudeAdapter.extract(loadFixture('short.html'));
    expect(convo.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('keeps the newlines a user typed and separates their paragraphs', async () => {
    // User bodies are `p.whitespace-pre-wrap`, so interior newlines are content, not
    // markup whitespace — they must not go through the serializer's collapsing path.
    const [first] = (await claudeAdapter.extract(loadFixture('short.html'))).messages;
    expect(first.content).toBe(
      'First user question.\nSecond line of the same paragraph.\n\nA separate paragraph.',
    );
  });

  it('preserves list markers in a user turn', async () => {
    const convo = await claudeAdapter.extract(loadFixture('short.html'));
    expect(convo.messages[2].content).toBe('A follow-up with a list:\n\n- alpha\n- beta');
  });

  it('serializes assistant prose to Markdown, including lists and a language-tagged fence', async () => {
    const convo = await claudeAdapter.extract(loadFixture('short.html'));
    expect(convo.messages[1].content).toBe(
      'Here is an answer with **bold** and `inline code`.\n\n' +
        '1. First step\n2. Second step\n\n' +
        '```sql\nSELECT id\nFROM users;\n```',
    );
  });

  it('omits the message id, which Claude does not expose', async () => {
    const convo = await claudeAdapter.extract(loadFixture('short.html'));
    expect(convo.messages.every((m) => m.id === undefined)).toBe(true);
  });

  it('fails loud rather than returning an empty conversation', async () => {
    await expect(claudeAdapter.extract(docFrom('<body><main>no turns here</main></body>'))).rejects.toBeInstanceOf(
      ExtractionError,
    );
  });

  it('fails loud when a turn is present but unreadable, instead of dropping it', async () => {
    const html =
      '<body>' +
      '<div data-index="0"><div data-testid="user-message"><p>a question</p></div></div>' +
      // An assistant container that rendered with no content at all.
      '<div data-index="1"><div class="standard-markdown"></div></div>' +
      '</body>';
    await expect(claudeAdapter.extract(docFrom(html))).rejects.toBeInstanceOf(ExtractionError);
  });

  // The thinking-block filter is applied on BOTH paths — the scroll walk and this one-shot
  // read — so that the two cannot drift apart. `collect-virtualized.test.ts` pins the walk;
  // this pins the snapshot, against a real DOM rather than a hand-rolled fake, so the
  // `closest('[data-timeline-text]')` ancestor test is exercised for real.
  //
  // It also pins the ORDER of the filter against the completeness check: `readSnapshot`
  // compares its message count to `nodes.length`, so filtering after that check would count
  // the dropped block as a turn that could not be read and fail this export outright.
  it('excludes an expanded thinking block on the one-shot path too', async () => {
    const html =
      '<body>' +
      '<div data-index="0"><div data-testid="user-message"><p>a question</p></div></div>' +
      '<div data-index="1">' +
      // Live 2026-07-29: the thinking container is distinguished by a `data-timeline-text`
      // ancestor, and renders BEFORE the answer in the same row.
      '<div data-timeline-text><div class="standard-markdown"><p>the user wants X</p></div></div>' +
      '<div class="standard-markdown"><p>the answer</p></div>' +
      '</div>' +
      '</body>';
    const convo = await claudeAdapter.extract(docFrom(html));
    expect(convo.messages).toHaveLength(2);
    expect(convo.messages[1].content).toBe('the answer');
  });

  // The filter drops a thinking block only when its row holds a non-thinking node too. With no
  // row ancestor at all there is no evidence an answer was rendered beside it, so it is kept —
  // dropping it would turn the only content there is into an empty turn, which fails the whole
  // export.
  it('keeps a thinking block that has no row to prove an answer rendered beside it', async () => {
    const html =
      '<body>' +
      '<div data-index="0"><div data-testid="user-message"><p>a question</p></div></div>' +
      '<div data-timeline-text><div class="standard-markdown"><p>still reasoning</p></div></div>' +
      '</body>';
    const convo = await claudeAdapter.extract(docFrom(html));
    expect(convo.messages).toHaveLength(2);
    expect(convo.messages[1].content).toBe('still reasoning');
  });

  it('retains a measured artifact card in the corresponding assistant message', async () => {
    const html =
      '<body>' +
      '<div data-index="0"><div data-testid="user-message"><p>a question</p></div></div>' +
      '<div data-index="1">' +
      '<div class="group/artifact-block"><div class="artifact-block-cell">' +
      '<div class="leading-tight text-sm line-clamp-1">Pv probe artifact</div>' +
      '<div class="text-xs line-clamp-1">HTML</div>' +
      '</div></div>' +
      '<div class="standard-markdown"><p>the answer</p></div>' +
      '</div>' +
      '</body>';
    const convo = await claudeAdapter.extract(docFrom(html));
    expect(convo.messages).toEqual([
      { role: 'user', content: 'a question' },
      { role: 'assistant', content: '[Artifact: Pv probe artifact (HTML)]\n\nthe answer' },
    ]);
  });

  it('fails loud when a measured artifact card has no readable kind', async () => {
    const html =
      '<body>' +
      '<div data-index="0"><div data-testid="user-message"><p>a question</p></div></div>' +
      // `role="article"` marks this as a conversation row — the marker that lets a malformed
      // card FAIL the export. Measured on every indexed message row (112/112).
      '<div data-index="1"><div role="article" aria-setsize="2">' +
      '<div class="group/artifact-block"><div class="artifact-block-cell">' +
      '<div class="leading-tight text-sm line-clamp-1">Pv probe artifact</div>' +
      '</div></div>' +
      '<div class="standard-markdown"><p>the answer</p></div>' +
      '</div></div>' +
      '</body>';
    await expect(claudeAdapter.extract(docFrom(html))).rejects.toBeInstanceOf(ExtractionError);
  });

  it('fails loud when a measured artifact card carries two kind nodes', async () => {
    // The hazard the 2026-08-10 measurement went looking for: a SECOND
    // `text-xs line-clamp-1` node inside a card (a timestamp, a version badge) would make the
    // kind ambiguous. It appeared in none of the four artifact kinds measured, so this is the
    // unobserved branch — but `selectors.ts` states in prose that the failure is loud rather
    // than a silently mislabelled artifact, and that claim is only worth stating if it is pinned.
    const html =
      '<body>' +
      '<div data-index="0"><div data-testid="user-message"><p>a question</p></div></div>' +
      '<div data-index="1"><div role="article" aria-setsize="2">' +
      '<div class="group/artifact-block"><div class="artifact-block-cell">' +
      '<div class="leading-tight text-sm line-clamp-1">Pv probe artifact</div>' +
      '<div class="text-xs line-clamp-1">HTML</div>' +
      '<div class="text-xs line-clamp-1">v2</div>' +
      '</div></div>' +
      '<div class="standard-markdown"><p>the answer</p></div>' +
      '</div></div>' +
      '</body>';
    await expect(claudeAdapter.extract(docFrom(html))).rejects.toBeInstanceOf(ExtractionError);
  });

  it('ignores an artifact-shaped node outside the message list instead of failing the export', async () => {
    // `data-index` is a generic virtualizer attribute, so a malformed card in some other
    // indexed widget (an artifact side panel, a menu) must not abort a conversation that
    // reads perfectly well.
    const html =
      '<body>' +
      '<div data-index="0"><div role="article" aria-setsize="1">' +
      '<div data-testid="user-message"><p>a question</p></div></div></div>' +
      '<div data-index="9"><div class="artifact-block-cell">stray panel</div></div>' +
      '</body>';
    const convo = await claudeAdapter.extract(docFrom(html));
    expect(convo.messages).toEqual([{ role: 'user', content: 'a question' }]);
  });

  it('does not double-count: a user bubble and an assistant container never overlap', async () => {
    // Live-verified (2026-07-25): zero `.standard-markdown` nested inside a user turn, so
    // the union selector yields each turn exactly once.
    const convo = await claudeAdapter.extract(loadFixture('short.html'));
    expect(convo.messages).toHaveLength(4);
  });

  // Attachments are read off the ROW, not the turn node — the tiles are a sibling subtree
  // (live 2026-07-29: zero `<img>` inside `user-message`, across four mixed turns and one
  // attachment-only turn). The scroll walk has done this since PR #51; these pin the one-shot
  // path, which is not only the fixture path but the LIVE fallback whenever there is no scroll
  // container or it has zero height (a background tab). Left unscanned, that path drops an
  // attachment-only turn with no error at all — the row holds no turn node, so the
  // count-based completeness check cannot see it (AGENTS.md #4).
  describe('attachments on the one-shot path', () => {
    // Live 2026-07-25 (row 50 of a 56-row conversation): a turn holding only files renders NO
    // `user-message` node. `action-bar-edit` is what attributes it to the user.
    // Live 2026-07-25: every indexed row carries a `role="article"` with `aria-setsize`
    // (112/112 across four conversations), the attachment-only row included. It is what tells a
    // conversation row from any other indexed element on the page, so the rows here render it.
    const attachmentRow = (index: number, tiles: string, extra = ''): string =>
      `<div data-index="${index}">` +
      '<div role="article" aria-setsize="2"></div>' +
      '<div data-testid="action-bar-edit"></div>' +
      tiles +
      extra +
      '</div>';

    it('describes an attachment-only turn instead of dropping it silently', async () => {
      const html =
        '<body>' +
        '<div data-index="0"><div data-testid="user-message"><p>a question</p></div></div>' +
        attachmentRow(1, '<button><img alt="report.pdf"></button>') +
        '</body>';
      const convo = await claudeAdapter.extract(docFrom(html));
      expect(convo.messages).toHaveLength(2);
      expect(convo.messages[1]).toEqual({ role: 'user', content: '[File: report.pdf]' });
    });

    it('reads the file-card shape too, which renders no `<img>` in the row', async () => {
      // The second measured tile shape (2026-07-29). Neither shape may be selected by file
      // type — a PNG was measured producing each — so both are read.
      const html =
        '<body>' +
        attachmentRow(
          0,
          '<div data-testid="file-thumbnail"><button><div><h3>pv-probe-note.txt</h3></div></button></div>',
        ) +
        '<div data-index="1"><div class="standard-markdown"><p>an answer</p></div></div>' +
        '</body>';
      const convo = await claudeAdapter.extract(docFrom(html));
      expect(convo.messages[0]).toEqual({ role: 'user', content: '[File: pv-probe-note.txt]' });
    });

    it('reports the attachment on a mixed turn instead of exporting the text alone', async () => {
      // The tile precedes the text body in document order (measured on row 0 — neither
      // contains the other, tile first), so the marker leads the message.
      const html =
        '<body>' +
        attachmentRow(
          0,
          '<button><img alt="notes.txt"></button>',
          '<div data-testid="user-message"><p>have a look at this</p></div>',
        ) +
        '</body>';
      const convo = await claudeAdapter.extract(docFrom(html));
      expect(convo.messages).toHaveLength(1);
      expect(convo.messages[0]).toEqual({
        role: 'user',
        content: '[File: notes.txt]\n\nhave a look at this',
      });
    });

    it('leaves a plain turn untouched — no marker is invented for a row with no tile', async () => {
      const convo = await claudeAdapter.extract(loadFixture('short.html'));
      expect(convo.messages.every((m) => !m.content.includes('[File:'))).toBe(true);
    });

    it('fails loud on a row that yields neither a turn nor a readable tile', async () => {
      // A tile that rendered without a name yields no marker rather than a fabricated one
      // (AGENTS.md #5), which leaves the row claimed by nothing. That must be a visible
      // error, not a position quietly missing from the export.
      const html =
        '<body>' +
        '<div data-index="0"><div data-testid="user-message"><p>a question</p></div></div>' +
        attachmentRow(1, '<button><img alt=""></button>') +
        '</body>';
      await expect(claudeAdapter.extract(docFrom(html))).rejects.toBeInstanceOf(ExtractionError);
    });

    // Only a row that looks like a conversation row may fail the export. `data-index` is a
    // generic virtualizer attribute, and this path runs against the WHOLE document live
    // (no scroll container, or a background tab) — so one stray indexed element elsewhere on
    // the page must not turn a working export into an error.
    it('ignores an indexed element that is not a conversation row', async () => {
      const html =
        '<body>' +
        '<div data-index="0"><div role="article" aria-setsize="1"></div>' +
        '<div data-testid="user-message"><p>a question</p></div></div>' +
        // A sidebar entry, a menu item, any other virtualized widget: indexed, but no article.
        '<nav><div data-index="7">Yesterday’s chat</div></nav>' +
        '</body>';
      const convo = await claudeAdapter.extract(docFrom(html));
      expect(convo.messages).toEqual([{ role: 'user', content: 'a question' }]);
    });
  });

  // Live 2026-07-25: a 56-row conversation held one row with FOUR `.standard-markdown` blocks,
  // all of them one assistant turn's content. The walk joins them; so does this path, so the
  // two cannot report the same conversation differently.
  it('joins several assistant blocks sharing one row into a single message', async () => {
    const html =
      '<body>' +
      '<div data-index="0"><div data-testid="user-message"><p>a question</p></div></div>' +
      '<div data-index="1">' +
      '<div class="standard-markdown"><p>first block</p></div>' +
      '<div class="standard-markdown"><p>second block</p></div>' +
      '</div>' +
      '</body>';
    const convo = await claudeAdapter.extract(docFrom(html));
    expect(convo.messages).toHaveLength(2);
    expect(convo.messages[1]).toEqual({ role: 'assistant', content: 'first block\n\nsecond block' });
  });
});
