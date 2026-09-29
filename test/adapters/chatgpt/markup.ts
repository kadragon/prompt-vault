// Synthetic ChatGPT "app-shell" conversation markup for tests that need a shape the captured
// fixtures do not hold (an empty reply, an image-only prompt, a multi-step reply). Each
// builder mirrors the live structure measured on 2026-09-29 (docs/live-dom-verification.md),
// reduced to the attributes the adapter reads — keep it in step with
// `src/adapters/chatgpt/selectors.ts`.

/** A user message unit. `bubble` is the pre-wrap text; `tiles` sit beside the bubble. */
export function userUnit(id: string, bubble: string | null, tiles = ''): string {
  const text =
    bubble === null
      ? ''
      : '<div data-user-message-bubble="true"><div class="whitespace-pre-wrap">' + bubble + '</div></div>';
  return (
    `<div class="group/user-message flex flex-col" data-chatgpt-search-message-ids="${id}">` +
    tiles +
    `<div class="w-full">${text}</div></div>`
  );
}

/**
 * The bubble body of a prompt that holds a fenced block: ChatGPT renders it through its
 * Markdown pipeline (paragraphs, inline-code spans, code blocks) rather than as plain text.
 */
export function userMarkdownBubble(inner: string): string {
  return `<div data-markdown-text-tone="user-message">${inner}</div>`;
}

/** An uploaded-file card, as rendered beside a user bubble. */
export function fileTile(name: string): string {
  return (
    '<div class="flex w-full flex-wrap"><span><span class="group/resource-card relative">' +
    `<button type="button" aria-label="${name}"></button>` +
    `<span><span title="${name}">${name}</span><span>문서</span></span></span></span></div>`
  );
}

/** An uploaded-image tile. */
export const IMAGE_TILE =
  '<div class="flex flex-wrap"><div role="button"><img src="https://example.invalid/i.png"></div></div>';

/** An assistant message unit. `ids` is the raw id list; `prose` the rendered reply. */
export function assistantUnit(ids: string, prose: string): string {
  return (
    `<div data-chatgpt-search-message-ids="${ids}">` +
    '<h4 class="sr-only" data-conversation-role="assistant">ChatGPT의 말:</h4>' +
    '<div class="group flex min-w-0 flex-col">' +
    `<div data-markdown-text-style="assistant-message">${prose}</div></div></div>`
  );
}

/** One turn wrapping its message units in reading order. */
export function turn(key: string, ...units: string[]): string {
  return `<div data-turn-key="${key}"><div class="flex flex-col">${units.join('')}</div></div>`;
}

/** A whole page around the given turns. */
export function page(title: string, ...turns: string[]): string {
  return `<!DOCTYPE html><html><head><title>${title}</title></head><body><main>${turns.join('')}</main></body></html>`;
}
