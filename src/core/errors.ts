// Typed error for the fail-loud golden principle (AGENTS.md #4): when extraction
// yields an empty or malformed conversation, the adapter throws this instead of
// returning a partial/empty model. The content script catches it and surfaces a
// visible error to the user — never a silent or empty download.

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionError';
    // Restore the prototype chain so `instanceof ExtractionError` holds after the
    // TypeScript ES-target down-level of `extends Error`.
    Object.setPrototypeOf(this, ExtractionError.prototype);
  }
}
