// The normalized, provider-agnostic conversation model. This is the ONLY type
// adapters and exporters share (see docs/architecture.md): adapters scrape a site
// into this shape, exporters render it. Dependencies point downward only — nothing
// here imports an adapter or an exporter.

export type Role = 'user' | 'assistant' | 'system';

export interface Message {
  role: Role;
  /**
   * Message body as GitHub-flavored Markdown. The adapter (the only DOM-aware
   * layer) is responsible for normalizing provider HTML into Markdown here, so
   * exporters stay DOM-free (docs/conventions.md). User turns, already typed as
   * plain text, are carried through verbatim.
   */
  content: string;
  /** Provider-assigned message id, when the page exposes one. */
  id?: string;
}

export interface Conversation {
  title: string;
  /** Source provider slug, e.g. `chatgpt`. */
  provider: string;
  /** URL the conversation was captured from. */
  url: string;
  /** ISO timestamp when known; the DOM rarely exposes it, so it is optional. */
  createdAt?: string;
  messages: Message[];
}
