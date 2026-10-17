import { afterEach, describe, it, expect, vi } from 'vitest';
import { Window } from 'happy-dom';
import { geminiAdapter } from '../../../src/adapters/gemini';
import { ExtractionError } from '../../../src/core/errors';
import {
  ERR_GEMINI_NOTEBOOK_HOME_LINK_MISSING,
  ERR_GEMINI_NOTEBOOK_HOME_TIMED_OUT,
  ERR_GEMINI_NOTEBOOK_LIST_LOADING,
  ERR_GEMINI_NOTEBOOK_LIST_MISSING,
  ERR_GEMINI_NOTEBOOK_OPEN_MISMATCH,
  ERR_GEMINI_NOTEBOOK_ROW_MALFORMED,
  ERR_GEMINI_NOTEBOOK_ROW_MISSING,
  ERR_GEMINI_OPEN_TIMED_OUT,
  ERR_GEMINI_OPEN_URL_MALFORMED,
} from '../../../src/strings';

afterEach(() => vi.unstubAllGlobals());

const NOTEBOOK = '090a4448-ad58-41ca-97c0-cdb5c264878f';
const OTHER_NOTEBOOK = '11111111-2222-3333-4444-555555555555';
const HOME = `/notebook/${NOTEBOOK}`;
const CHAT_A = '0123456789abcdef';
const CHAT_B = 'fedcba9876543210';

// Live shape (2026-10-15 / 2026-10-17): `project-chat-history` > … > `project-chat-row` >
// `button[data-test-id="navigate-to-recent-chat"]` > … > `h2[data-test-id="chat-title"]`.
function row(title: string): string {
  return (
    '<project-chat-row><div class="project-chat-row-container">' +
    `<button data-test-id="navigate-to-recent-chat"><div class="chat-header"><div class="chat-title-container"><h2 data-test-id="chat-title">${title}</h2></div></div></button>` +
    '<button class="menu-button"></button></div></project-chat-row>'
  );
}

function historyShell(inner: string): string {
  return `<project-chat-history><div class="project-chat-history-container"><infinite-scroller class="project-chat-history-scroller">${inner}</infinite-scroller></div></project-chat-history>`;
}

/** A settled member list: every row in, no loading placeholder. */
function history(...titles: string[]): string {
  return historyShell(`<h2 data-test-id="past-chats-title">Past chats</h2>${titles.map(row).join('')}`);
}

/** Mid-hydration (measured 2026-10-17): the newest rows are in and the placeholder is still up. */
function loadingHistory(...titles: string[]): string {
  return historyShell(
    `<h2 data-test-id="past-chats-title">Past chats</h2>${titles.map(row).join('')}<project-list-skeleton data-test-id="skeleton"></project-list-skeleton>`,
  );
}

/** A notebook with zero chats, which renders a positive empty-state marker. */
function emptyHistory(): string {
  return historyShell('<h2 data-test-id="past-chats-title">Past chats</h2><div data-test-id="notebook-empty-state"><span>Notebook chats appear here.</span></div>');
}

function sidebar(...notebooks: string[]): string {
  return notebooks
    .map((id) => `<gem-nav-list-item data-test-id="project-item-button-gem"><a href="/notebook/${id}">Notebook</a></gem-nav-list-item>`)
    .join('');
}

function exchange(text: string, id: string): string {
  return `<div class="conversation-container" id="${id}"><user-query>${text}</user-query></div>`;
}

/** A parsed page at `pathname`; the notebook's sidebar entry is included unless `withSidebar` is false. */
function fixture(html: string, pathname = HOME, withSidebar = true): Document {
  const window = new Window({ url: `https://gemini.google.com${pathname}` });
  window.document.write((withSidebar ? sidebar(NOTEBOOK) : '') + html);
  return window.document as unknown as Document;
}

/** A live-page stub whose `location.pathname` the click handlers below can move. */
function installLivePage(html: string, pathname: string): { doc: Document; go: (path: string) => void } {
  const window = new Window();
  window.document.write(html);
  const loc = { origin: 'https://gemini.google.com', pathname };
  vi.stubGlobal('document', window.document);
  vi.stubGlobal('location', loc);
  return { doc: window.document as unknown as Document, go: (path) => (loc.pathname = path) };
}

/** The synthetic member URL the listing mints for `index`, read back off a fixture listing. */
function memberUrl(titles: string[], index: number): string {
  return geminiAdapter.listProjectConversations!(fixture(history(...titles)))[index].url;
}

/**
 * Wire every member row so clicking row `i` opens `/app/<ids[i]>`, rendering `chat i` under the
 * row's own title in `document.title` — the shape measured live (2026-10-17). `titles` overrides
 * the opened chat's title per row, to model a click that lands on a different chat.
 */
function wireRows(doc: Document, go: (path: string) => void, ids: string[], titles: (string | undefined)[] = []): void {
  doc.querySelectorAll('button[data-test-id="navigate-to-recent-chat"]').forEach((button, i) => {
    const rowTitle = button.querySelector('h2')?.textContent ?? '';
    button.addEventListener('click', () => {
      go(`/app/${ids[i]}`);
      doc.title = `${titles[i] ?? rowTitle} - Google Gemini`;
      doc.body.innerHTML = sidebar(NOTEBOOK) + exchange(`chat ${i}`, `c_${i}`);
    });
  });
}

describe('geminiAdapter.listProjectConversations', () => {
  it('lists every member in display order, keyed by notebook and position', () => {
    const list = geminiAdapter.listProjectConversations!(fixture(history('Newest', 'Older', 'Oldest')));
    expect(list.map((c) => c.title)).toEqual(['Newest', 'Older', 'Oldest']);
    expect(list.map((c) => c.id)).toEqual([0, 1, 2].map((i) => `notebook:${NOTEBOOK}:${i}`));
    for (const conversation of list) {
      expect(new URL(conversation.url).pathname).toBe(HOME);
    }
  });

  it('keeps an untitled member under a generic label rather than dropping it', () => {
    const list = geminiAdapter.listProjectConversations!(fixture(history('')));
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Gemini conversation');
  });

  it('round-trips a title holding URL-significant characters', async () => {
    const title = 'a&b=c#d %20 노트';
    const { doc, go } = installLivePage(sidebar(NOTEBOOK) + history(title), HOME);
    wireRows(doc, go, [CHAT_A]);
    await geminiAdapter.openProjectConversation!(memberUrl([title], 0), { pollMs: 0, timeoutMs: 200 });
    expect(doc.querySelector('user-query')?.textContent).toBe('chat 0');
  });

  it('fails loud on a notebook route whose member list is missing', () => {
    expect(() => geminiAdapter.listProjectConversations!(fixture('<main></main>'))).toThrow(
      new ExtractionError(ERR_GEMINI_NOTEBOOK_LIST_MISSING),
    );
  });

  it('fails loud on a row without exactly one chat button instead of shortening the notebook', () => {
    const broken = history('Fine').replace('</infinite-scroller>', '<project-chat-row><h2 data-test-id="chat-title">No button</h2></project-chat-row></infinite-scroller>');
    expect(() => geminiAdapter.listProjectConversations!(fixture(broken))).toThrow(
      new ExtractionError(ERR_GEMINI_NOTEBOOK_ROW_MALFORMED),
    );
  });

  it('reports an empty notebook as empty only on its positive marker', () => {
    expect(geminiAdapter.listProjectConversations!(fixture(emptyHistory()))).toEqual([]);
  });

  it('fails loud on a list that is still filling instead of listing its newest rows as the notebook', () => {
    // Measured 2026-10-17: a 31-chat notebook sat at 10 rows for ~200 ms with the placeholder up.
    for (const html of [loadingHistory('Newest', 'Older'), loadingHistory(), historyShell('')]) {
      expect(() => geminiAdapter.listProjectConversations!(fixture(html))).toThrow(
        new ExtractionError(ERR_GEMINI_NOTEBOOK_LIST_LOADING),
      );
    }
  });

  it('refuses to list while the notebook has no sidebar entry to return through', () => {
    // Otherwise the run saves its first member and then fails every other (measured with the
    // sidebar collapsed, 2026-10-17).
    expect(() => geminiAdapter.listProjectConversations!(fixture(history('First', 'Second'), HOME, false))).toThrow(
      new ExtractionError(ERR_GEMINI_NOTEBOOK_HOME_LINK_MISSING),
    );
    expect(geminiAdapter.listProjectConversations!(fixture(emptyHistory(), HOME, false))).toEqual([]);
  });

  it('returns nothing off a notebook route, where there is no notebook to key members by', () => {
    expect(geminiAdapter.listProjectConversations!(fixture(history('Stray'), `/app/${CHAT_A}`))).toEqual([]);
  });
});

describe('geminiAdapter.openProjectConversation', () => {
  it('clicks the listed row on the notebook home and waits for the chat it opens', async () => {
    const { doc, go } = installLivePage(sidebar(NOTEBOOK) + history('First', 'Second'), HOME);
    wireRows(doc, go, [CHAT_A, CHAT_B]);
    await geminiAdapter.openProjectConversation!(memberUrl(['First', 'Second'], 1), { pollMs: 0, timeoutMs: 200 });
    expect(location.pathname).toBe(`/app/${CHAT_B}`);
    expect(doc.querySelector('user-query')?.textContent).toBe('chat 1');
  });

  it('returns to the notebook through its own sidebar entry before opening the next member', async () => {
    // The batch leaves the user on the previous member's `/app/<id>` page; the next member's row
    // only exists on the notebook home.
    const { doc, go } = installLivePage(sidebar(OTHER_NOTEBOOK, NOTEBOOK) + exchange('previous', 'c_prev'), `/app/${CHAT_A}`);
    const links = doc.querySelectorAll('a');
    let wrongNotebook = 0;
    links[0].addEventListener('click', () => wrongNotebook++);
    links[1].addEventListener('click', () => {
      go(HOME);
      doc.body.innerHTML = sidebar(OTHER_NOTEBOOK, NOTEBOOK) + history('First', 'Second');
      wireRows(doc, go, [CHAT_A, CHAT_B]);
    });
    await geminiAdapter.openProjectConversation!(memberUrl(['First', 'Second'], 1), { pollMs: 0, timeoutMs: 200 });
    expect(wrongNotebook).toBe(0);
    expect(location.pathname).toBe(`/app/${CHAT_B}`);
  });

  it('waits out a member list that hydrates after the notebook home has routed', async () => {
    // Measured (2026-10-17): the list container lands before its rows, placeholder up.
    const { doc, go } = installLivePage(sidebar(NOTEBOOK) + loadingHistory(), HOME);
    setTimeout(() => {
      doc.body.innerHTML = sidebar(NOTEBOOK) + history('First');
      wireRows(doc, go, [CHAT_A]);
    }, 20);
    await geminiAdapter.openProjectConversation!(memberUrl(['First'], 0), { pollMs: 5, timeoutMs: 500 });
    expect(location.pathname).toBe(`/app/${CHAT_A}`);
  });

  it('does not match against the partial list while it is still filling', async () => {
    // Full list: 'Late' at 1 and again at 3; the member was listed at 3. While only the first two
    // rows are in, the unique-title fallback would pick the one at 1 — the wrong chat.
    const full = ['A', 'Late', 'B', 'Late'];
    const { doc, go } = installLivePage(sidebar(NOTEBOOK) + loadingHistory('A', 'Late'), HOME);
    wireRows(doc, go, ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb']);
    setTimeout(() => {
      doc.body.innerHTML = sidebar(NOTEBOOK) + history(...full);
      wireRows(doc, go, ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'cccccccccccccccc', CHAT_B]);
    }, 20);
    await geminiAdapter.openProjectConversation!(memberUrl(full, 3), { pollMs: 5, timeoutMs: 500 });
    expect(location.pathname).toBe(`/app/${CHAT_B}`);
  });

  it('times out visibly when the notebook list never finishes loading', async () => {
    installLivePage(sidebar(NOTEBOOK) + loadingHistory('First'), HOME);
    await expect(
      geminiAdapter.openProjectConversation!(memberUrl(['First'], 0), { pollMs: 0, timeoutMs: 30 }),
    ).rejects.toThrow(new ExtractionError(ERR_GEMINI_NOTEBOOK_HOME_TIMED_OUT));
  });

  it('follows a member whose position shifted when its title is still unique', async () => {
    // A chat added to the notebook mid-run lands at the top and pushes every member down one.
    const { doc, go } = installLivePage(sidebar(NOTEBOOK) + history('Brand new', 'First', 'Second'), HOME);
    wireRows(doc, go, ['aaaaaaaaaaaaaaaa', CHAT_A, CHAT_B]);
    await geminiAdapter.openProjectConversation!(memberUrl(['First', 'Second'], 1), { pollMs: 0, timeoutMs: 200 });
    expect(location.pathname).toBe(`/app/${CHAT_B}`);
  });

  it('refuses to guess between same-titled rows once the listed position no longer matches', async () => {
    // Opening either would export a chat under a title it may not own — a silent mis-export.
    const { doc, go } = installLivePage(sidebar(NOTEBOOK) + history('Brand new', 'Twin', 'Twin'), HOME);
    wireRows(doc, go, ['aaaaaaaaaaaaaaaa', CHAT_A, CHAT_B]);
    await expect(
      geminiAdapter.openProjectConversation!(memberUrl(['Twin', 'Twin'], 0), { pollMs: 0, timeoutMs: 30 }),
    ).rejects.toThrow(new ExtractionError(ERR_GEMINI_NOTEBOOK_ROW_MISSING));
    expect(location.pathname).toBe(HOME);
  });

  it('refuses the same-titled neighbour that a shift moved onto the listed position', async () => {
    // Reproduced in review: listed [Twin A, Twin B], ticked B (index 1); a new chat lands on top,
    // so index 1 now holds Twin A — same title, wrong chat.
    const { doc, go } = installLivePage(sidebar(NOTEBOOK) + history('New', 'Twin', 'Twin'), HOME);
    wireRows(doc, go, ['aaaaaaaaaaaaaaaa', CHAT_A, CHAT_B]);
    await expect(
      geminiAdapter.openProjectConversation!(memberUrl(['Twin', 'Twin'], 1), { pollMs: 0, timeoutMs: 30 }),
    ).rejects.toThrow(new ExtractionError(ERR_GEMINI_NOTEBOOK_ROW_MISSING));
    expect(location.pathname).toBe(HOME);
  });

  it('refuses a chat that opens under a different title than the ticked row', async () => {
    const { doc, go } = installLivePage(sidebar(NOTEBOOK) + history('First', 'Second'), HOME);
    wireRows(doc, go, [CHAT_A, CHAT_B], [undefined, 'Somebody else']);
    await expect(
      geminiAdapter.openProjectConversation!(memberUrl(['First', 'Second'], 1), { pollMs: 0, timeoutMs: 30 }),
    ).rejects.toThrow(new ExtractionError(ERR_GEMINI_NOTEBOOK_OPEN_MISMATCH));
  });

  it('waits out a document title that lags the opened render', async () => {
    const { doc, go } = installLivePage(sidebar(NOTEBOOK) + history('First'), HOME);
    wireRows(doc, go, [CHAT_A], ['Google Gemini']);
    doc.querySelector('button[data-test-id="navigate-to-recent-chat"]')?.addEventListener('click', () => {
      setTimeout(() => (doc.title = 'First - Google Gemini'), 20);
    });
    await geminiAdapter.openProjectConversation!(memberUrl(['First'], 0), { pollMs: 5, timeoutMs: 500 });
    expect(location.pathname).toBe(`/app/${CHAT_A}`);
  });

  it('accepts an untitled row, which has no title to compare', async () => {
    const { doc, go } = installLivePage(sidebar(NOTEBOOK) + history(''), HOME);
    wireRows(doc, go, [CHAT_A], ['Anything']);
    await geminiAdapter.openProjectConversation!(memberUrl([''], 0), { pollMs: 0, timeoutMs: 200 });
    expect(location.pathname).toBe(`/app/${CHAT_A}`);
  });

  it('opens the listed one of two same-titled rows while positions still hold', async () => {
    const { doc, go } = installLivePage(sidebar(NOTEBOOK) + history('Twin', 'Twin'), HOME);
    wireRows(doc, go, [CHAT_A, CHAT_B]);
    await geminiAdapter.openProjectConversation!(memberUrl(['Twin', 'Twin'], 1), { pollMs: 0, timeoutMs: 200 });
    expect(location.pathname).toBe(`/app/${CHAT_B}`);
  });

  it('fails loud when the notebook has no sidebar entry to return through', async () => {
    // Measured 2026-10-17: a collapsed sidebar renders no `/notebook/` anchor, and `history.back()`
    // changes the URL without Gemini re-rendering the notebook — there is no other way back.
    installLivePage(sidebar(OTHER_NOTEBOOK) + exchange('previous', 'c_prev'), `/app/${CHAT_A}`);
    await expect(
      geminiAdapter.openProjectConversation!(memberUrl(['First'], 0), { pollMs: 0, timeoutMs: 30 }),
    ).rejects.toThrow(new ExtractionError(ERR_GEMINI_NOTEBOOK_HOME_LINK_MISSING));
  });

  it('times out visibly when the sidebar entry never reaches the notebook home', async () => {
    installLivePage(sidebar(NOTEBOOK) + exchange('previous', 'c_prev'), `/app/${CHAT_A}`);
    await expect(
      geminiAdapter.openProjectConversation!(memberUrl(['First'], 0), { pollMs: 0, timeoutMs: 30 }),
    ).rejects.toThrow(new ExtractionError(ERR_GEMINI_NOTEBOOK_HOME_TIMED_OUT));
  });

  it('times out visibly when the clicked row never opens a conversation', async () => {
    installLivePage(sidebar(NOTEBOOK) + history('First'), HOME);
    await expect(
      geminiAdapter.openProjectConversation!(memberUrl(['First'], 0), { pollMs: 0, timeoutMs: 30 }),
    ).rejects.toThrow(new ExtractionError(ERR_GEMINI_OPEN_TIMED_OUT));
  });

  it('rejects a URL that is not a listed notebook member', async () => {
    installLivePage(sidebar(NOTEBOOK) + history('First'), HOME);
    for (const url of [
      `https://gemini.google.com/app/${CHAT_A}`,
      `https://gemini.google.com${HOME}`,
      `https://gemini.google.com${HOME}#pv-row=x&pv-count=1&pv-title=First`,
      `https://gemini.google.com${HOME}#pv-row=0&pv-title=First`,
    ]) {
      await expect(geminiAdapter.openProjectConversation!(url, { pollMs: 0, timeoutMs: 30 })).rejects.toThrow(
        new ExtractionError(ERR_GEMINI_OPEN_URL_MALFORMED),
      );
    }
  });
});

describe('geminiAdapter.openProjectHome', () => {
  it('does nothing when already on that notebook home', async () => {
    const { doc } = installLivePage(sidebar(NOTEBOOK) + history('First'), HOME);
    let clicks = 0;
    doc.querySelector('a')?.addEventListener('click', () => clicks++);
    await geminiAdapter.openProjectHome!(`https://gemini.google.com${HOME}`, { pollMs: 0, timeoutMs: 30 });
    expect(clicks).toBe(0);
  });

  it('returns from a member chat to the notebook the batch started on', async () => {
    const { doc, go } = installLivePage(sidebar(NOTEBOOK) + exchange('last', 'c_last'), `/app/${CHAT_A}`);
    doc.querySelector('a')?.addEventListener('click', () => {
      go(HOME);
      doc.body.innerHTML = sidebar(NOTEBOOK) + history('First');
    });
    await geminiAdapter.openProjectHome!(`https://gemini.google.com${HOME}`, { pollMs: 0, timeoutMs: 200 });
    expect(location.pathname).toBe(HOME);
  });
});

describe('geminiAdapter.projectToolbarMount', () => {
  it('mounts on the member list, and is absent until it renders', () => {
    const doc = fixture(history('First'));
    expect(geminiAdapter.projectToolbarMount!(doc)?.tagName.toLowerCase()).toBe('project-chat-history');
    expect(geminiAdapter.projectToolbarMount!(fixture('<main></main>'))).toBeNull();
  });
});
