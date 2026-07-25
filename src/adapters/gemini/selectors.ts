// Every Gemini DOM selector lives here, exactly once (docs/conventions.md). When
// Gemini's markup changes, this is the one file to update. Gemini's DOM is unstable —
// re-verify against the live page and refresh the fixture when extraction regresses.
// See docs/live-dom-verification.md for how a stamp below is earned.
//
// Gemini is an Angular app, so most of its classes are either Material (`mat-*`/`mdc-*`)
// or Angular scoping markers (`_ngcontent-ng-c…`, `ng-star-inserted`). The scoping markers
// are generated per build and MUST NOT be selected on; the semantic classes below are the
// ones that survived a live capture.

export const selectors = {
  /**
   * One exchange — a user turn AND the model's reply to it, wrapped together. This is
   * Gemini's unit of conversation structure: unlike ChatGPT and Claude, there is no
   * per-message wrapper, so a "turn" is read out of its half of this container.
   *
   * Its `id` is an opaque 16-hex exchange id — the only per-exchange identity Gemini
   * exposes. Being opaque, it is NOT ordered and cannot support a contiguity/gap check the
   * way Claude's numeric `data-index` does; document order is the conversation order.
   *
   * Verified against the live page (2026-07-25): the containers are direct children of the
   * scroll port, and all 16 containers of a 16-exchange conversation held exactly one
   * `user-query`, one `model-response` and one `.markdown` each.
   */
  exchange: 'div.conversation-container',

  /**
   * The user's half of an exchange. Gemini labels this side with its own element name
   * rather than a test id. Verified against the live page (2026-07-25): present once per
   * exchange container, 16/16.
   */
  userQuery: 'user-query',

  /**
   * The user text block inside `userQuery`. Carries `role="heading"` and `aria-level="2"`
   * (Gemini treats each prompt as a section heading), which is why it is matched by class
   * rather than by role. Verified against the live page (2026-07-25).
   */
  userQueryText: '.query-text',

  /**
   * One rendered line of the user's prompt. Read INSTEAD of `userQueryText`'s own
   * `textContent`, because that text also contains the screen-reader label below.
   * Verified against the live page (2026-07-25) on a single-line prompt:
   * `.query-text` > `span.cdk-visually-hidden` + `p.query-text-line`.
   *
   * NOT verified: that an N-line prompt renders N of these. Every attempt to type a newline
   * into Gemini's Quill editor through synthetic events failed (`insertLineBreak` cleared
   * the composer; a synthetic paste was ignored as untrusted), so the multi-line shape was
   * never captured — tracked as a `[VERIFY]` in tasks.md. `readUserContent` therefore joins
   * however many of these exist and falls back to the container text with the label removed,
   * which is correct for either shape rather than betting on one.
   */
  userQueryLine: 'p.query-text-line',

  /**
   * Angular Material's screen-reader-only label, which Gemini puts INSIDE the user text
   * block (live value: "말씀하신 내용" — localized, so its text is not matchable). A naive
   * `textContent` read of `.query-text` prepends it to the user's actual prompt, so it is
   * removed explicitly. Verified against the live page (2026-07-25):
   * `naiveTextContent` came back as `"말씀하신 내용 Line one of my question."`.
   */
  screenReaderLabel: 'span.cdk-visually-hidden',

  /**
   * The model's half of an exchange. Its presence (rather than its content) is what
   * distinguishes "the model replied" from "this exchange has a prompt only".
   * Verified against the live page (2026-07-25): present once per exchange, 16/16.
   */
  modelResponse: 'model-response',

  /**
   * The model's rendered prose container — the subtree handed to `htmlToMarkdown`. Same
   * class name ChatGPT uses (`.markdown`), unlike Claude, where no ChatGPT selector
   * transfers. Verified against the live page (2026-07-25): one per exchange, carrying
   * `id="model-response-message-content…"`, `aria-live="polite"`, and standard `p`/`ol`/`li`
   * markup.
   *
   * Gemini's response chrome — `sources-list`, `thinking-overlay`, `message-actions` — sits
   * OUTSIDE this element (measured: none of them appear among its descendants), so reading
   * it excludes all of them without any filtering.
   */
  assistantMarkdown: '.markdown',

  /**
   * Attribute on `assistantMarkdown` that is `"true"` while the response is generating and
   * `"false"` once it is finished — the stream-completion signal neither the ChatGPT nor the
   * Claude adapter has.
   *
   * Verified against the live page (2026-07-25) by sampling every 300 ms across a response:
   * the generating turn read `true` for ~2.4 s AFTER its text stopped growing, so it is
   * strictly stronger than a "content stopped changing" heuristic. The input area's
   * "대답 생성 중지" button tracks the same state but its label is localized, so this
   * attribute is the machine-readable form.
   */
  streamingAttr: 'aria-busy',

  /**
   * The scroll viewport holding the exchange list. Scoped by test id on purpose: the
   * document contains a SECOND `infinite-scroller` (the history sidebar) that also
   * overflows, and a bare tag selector would sometimes scroll the wrong one.
   *
   * Despite the element's name, this list is NOT a recycling virtualizer. Verified against
   * the live page (2026-07-25): a fresh load renders only the newest **10** exchanges
   * (measured twice — an 11-exchange conversation rendered 10, a 16-exchange one rendered
   * 10), the rest arrive in one batch when the walk reaches the top of the loaded range
   * (10 → 16, `scrollHeight` 5019 → 9129), and nothing is ever trimmed afterwards (a
   * 35-round up-then-down walk held the full count on every round). Append-only, like
   * ChatGPT's `#history` — the opposite of Claude's message list. Do not generalize either
   * provider's model to a third.
   */
  scrollContainer: 'infinite-scroller[data-test-id="chat-history-container"]',

  /**
   * A fenced code block inside `assistantMarkdown`. Verified against the live page
   * (2026-07-25): `code-block` > … > `div.code-block-decoration` + `pre > code`.
   */
  codeBlock: 'code-block',

  /**
   * Where Gemini declares a fence's language — a header label ("Python", "JSON",
   * "Markdown"), rendered as a SIBLING of the `<pre>`. Two consequences, both handled in
   * the adapter:
   *
   *  1. `codeLanguage()` in `src/core/html-to-markdown.ts` reads a `language-*` class on the
   *     `<code>` and otherwise looks inside the `<pre>`. Gemini tags no class (live:
   *     `class="code-container formatted …"`, highlight.js `hljs-*` spans inside) and puts
   *     the label outside the `<pre>`, so core sees neither — the adapter copies the label
   *     onto the `<code>` first.
   *  2. Being a sibling of the `<pre>`, this label would otherwise be serialized as an
   *     ordinary paragraph of prose ("Python" on its own line), so it is removed.
   *
   * Verified against the live page (2026-07-25); note one block in the same response
   * rendered with no decoration at all, so an absent label is a normal case, not an anomaly.
   */
  codeLanguageLabel: 'div.code-block-decoration',

  /**
   * The copy/edit controls Gemini renders beside a code block. Removed for the same reason
   * as the language label: they are siblings of the `<pre>`, so any text they carry would
   * become prose. Verified against the live page (2026-07-25): `div.buttons` holding two
   * `gem-icon-button`s, on each of the three labelled blocks in one response — the unlabelled
   * block had neither a control row nor a decoration. `normalizeCodeBlocks` removes every match
   * within a block, so that count is a record of what was measured, not something the code
   * relies on.
   */
  codeBlockButtons: 'div.buttons',

  /**
   * The conversation header's right-hand action group — the injection point for the export
   * buttons. Verified against the live page (2026-07-25):
   * `top-bar-actions > div.top-bar-actions > div.left-section | div.center-section |
   * div.right-section`, with the right section holding the native controls (a
   * `tts-control-v2` "듣기" button and the conversation-actions menu). Gemini has **no Share
   * button**, so unlike ChatGPT and Claude there is no share control to sit beside.
   */
  headerActions: 'top-bar-actions div.top-bar-actions div.right-section',

  /**
   * Gemini's native text-to-speech control, the leftmost thing in the header action group —
   * the anchor the export buttons are inserted ahead of, so they sit beside the native
   * controls instead of after them. Verified against the live page (2026-07-25).
   */
  ttsControl: 'tts-control-v2',
} as const;

/**
 * Suffix Gemini appends to the conversation title in `document.title`
 * (`"<conversation title> - Google Gemini"`). Verified against the live page (2026-07-25).
 */
export const TITLE_SUFFIX = ' - Google Gemini';

/**
 * Left-to-right mark. Gemini prefixes `document.title` with U+200E while a conversation is
 * loading (observed as the bare title `"‎Google Gemini"`, charCode 8206 at index 0), and the
 * character is invisible — so a title compared or trimmed without stripping it silently
 * fails to match. Verified against the live page (2026-07-25).
 */
export const LRM = '‎';
