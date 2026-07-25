// Every Claude DOM selector lives here, exactly once (docs/conventions.md). When
// Claude's markup changes, this is the one file to update. Claude's DOM is unstable —
// re-verify against the live page and refresh the fixture when extraction regresses.
// See docs/live-dom-verification.md for how a stamp below is earned.

export const selectors = {
  /**
   * A user turn. Claude marks only the user side with a test id; assistant turns carry
   * no equivalent, which is why `turn` below is a union rather than one attribute.
   * The element holds the message body directly (a `p.whitespace-pre-wrap` per
   * paragraph). Verified against the live page (2026-07-25): 7 present on a 7-user-turn
   * viewport, corroborated by an equal count of `data-user-message-bubble`.
   */
  userMessage: '[data-testid="user-message"]',

  /**
   * The assistant's rendered prose container — Claude's analogue of ChatGPT's
   * `.markdown`. Holds `p.font-claude-response-body`, lists, and `pre > code` blocks.
   * Verified against the live page (2026-07-25); `.markdown` and `[class*="prose"]`
   * both resolve to zero elements on Claude, so no ChatGPT selector is reusable here.
   */
  assistantMarkdown: '.standard-markdown',

  /**
   * Any message turn, either role, matched in one query so document order alone gives
   * the on-screen interleaving — Claude exposes no per-turn wrapper carrying the role,
   * so a turn IS either a user bubble or an assistant prose container. Role is then
   * decided by testing the matched element against `userMessage`. Verified against the
   * live page (2026-07-25): no `.standard-markdown` is nested inside a
   * `[data-testid="user-message"]` (overlap count 0), so the two sets are disjoint and
   * a turn can never be counted twice.
   */
  turn: '[data-testid="user-message"], .standard-markdown',

  /**
   * The virtualizer's row wrapper, an ancestor of each turn. Its `data-index` is the
   * turn's position in the full conversation, which is the only stable identity Claude
   * exposes — there is no `data-message-id` analogue — so it serves as both the dedupe
   * key and the sort key while accumulating across scroll rounds, and its numbering is
   * what lets extraction detect a gap instead of silently returning a partial.
   * Verified against the live page (2026-07-25): 50 distinct values were surfaced on a
   * conversation that never rendered more than 16 turn nodes at once.
   */
  turnRow: '[data-index]',

  /** Attribute holding the row's conversation-position index. */
  turnIndexAttr: 'data-index',

  /**
   * Scroll viewport that virtualizes the message list. Claude *recycles* turn nodes —
   * scrolling to the top dropped the rendered count from 16 to 8 while surfacing
   * different turns — so extraction must scroll this element and accumulate, and a
   * one-shot `querySelectorAll` would silently return a fraction of the conversation
   * (AGENTS.md #4). Matched on a stable data attribute rather than its class soup.
   * Verified against the live page (2026-07-25): the only content scroll port,
   * `scrollHeight 2922 > clientHeight 592`, carrying `data-autoscroll-container`.
   */
  scrollContainer: '[data-autoscroll-container]',

  /**
   * The header action bar holding Claude's native controls (Share, chat options). The
   * export buttons are injected here so they sit inline with Share instead of a fixed
   * overlay covering it. Verified against the live page (2026-07-25).
   */
  headerActions: '[data-testid="wiggle-controls-actions"]',

  /**
   * Claude's native Share button inside the header action bar — the anchor the export
   * buttons are placed to the left of (beside it, not replacing it). Verified against
   * the live page (2026-07-25).
   */
  shareButton: '[data-testid="wiggle-controls-actions-share"]',
} as const;

/**
 * Suffix Claude appends to the conversation title in `document.title`
 * (`"<conversation title> - Claude"`). Stripped to recover the bare title; a page whose
 * title is exactly `Claude` has no conversation title yet and falls back. Verified
 * against the live page (2026-07-25).
 */
export const TITLE_SUFFIX = ' - Claude';
