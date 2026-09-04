// Typed error for the fail-loud golden principle (AGENTS.md #4): when extraction
// yields an empty or malformed conversation, the adapter throws this instead of
// returning a partial/empty model. The content script catches it and surfaces a
// visible error to the user — never a silent or empty download.

export class ExtractionError extends Error {
  // `options` carries the underlying failure as `cause` where there is one (e.g. the
  // font fetch in src/export/fonts/jetendard.ts): the message shown to the user is
  // deliberately non-technical, so the original error would otherwise be lost.
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ExtractionError';
    // Restore the prototype chain so `instanceof ExtractionError` holds after the
    // TypeScript ES-target down-level of `extends Error`.
    Object.setPrototypeOf(this, ExtractionError.prototype);
  }
}
