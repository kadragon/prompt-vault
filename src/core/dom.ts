// Shared DOM primitives every adapter needs but none owns. Provider-agnostic by
// construction: nothing here reads a selector or knows which site it is running on
// (docs/architecture.md — `src/core/` never imports from `src/adapters/`).

const DOCUMENT_NODE = 9;

/**
 * The `Document` a scrape root belongs to, or null when it has none (a detached node).
 * Adapters need it to reach `defaultView` for `getComputedStyle` and to scope queries.
 */
export function ownerDocument(root: ParentNode): Document | null {
  // Detect a Document by nodeType rather than `instanceof Document` so this works under
  // any DOM implementation (live browser or a parsed test fixture).
  if ((root as Node).nodeType === DOCUMENT_NODE) return root as Document;
  return (root as Element).ownerDocument ?? null;
}
