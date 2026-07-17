import { pickAdapter } from '../adapters';
import { ExtractionError } from '../core/errors';
import { markdownFilename, toMarkdown } from '../export/markdown';
import {
  DOWNLOAD_MD_ARIA_LABEL,
  DOWNLOAD_MD_LABEL,
  DOWNLOAD_PDF_ARIA_LABEL,
  DOWNLOAD_PDF_LABEL,
  EXPORT_FAILED_MESSAGE,
  EXPORT_NO_ADAPTER_MESSAGE,
} from '../strings';
import { assertConversationNonEmpty } from './guard';
import { isConversationPage } from './page';

// Stable id on the button container so it is mounted at most once and can be
// located for removal / re-injection.
export const CONTAINER_ID = 'prompt-vault-download-buttons';

// Export formats offered by the toolbar, in display order.
type Format = 'md' | 'pdf';
interface FormatSpec {
  format: Format;
  /** Short label; shown only on the self-styled overlay fallback (native is icon-only). */
  label: string;
  ariaLabel: string;
  /** Builds the format's glyph for the icon-only native buttons. */
  icon: (doc: Document) => SVGElement;
}
const FORMATS: ReadonlyArray<FormatSpec> = [
  { format: 'md', label: DOWNLOAD_MD_LABEL, ariaLabel: DOWNLOAD_MD_ARIA_LABEL, icon: markdownIcon },
  { format: 'pdf', label: DOWNLOAD_PDF_LABEL, ariaLabel: DOWNLOAD_PDF_ARIA_LABEL, icon: pdfIcon },
];

// Stylesheet injected once to hide native header controls the export buttons
// supersede (the adapter's `toolbarHiddenSelectors`). A stylesheet — not inline
// `display:none` — so the rule keeps applying to freshly-rendered elements when
// ChatGPT's SPA re-renders the header, with no JS re-hiding needed.
export const HIDDEN_STYLE_ID = 'prompt-vault-hidden-styles';

// Placement is stamped on the container so `syncButtons` can tell a native mount
// from a fallback overlay and upgrade the latter once the header bar appears.
const PLACEMENT_ATTR = 'data-prompt-vault-placement';

// Blocks a second export while one is in flight. A module-level flag (not the
// buttons' `disabled` state) so the guard survives the buttons being re-mounted
// mid-export by an SPA header re-render — the fresh buttons default to enabled, but
// their click still short-circuits here.
let exportInFlight = false;

const SVG_NS = 'http://www.w3.org/2000/svg';

// Format glyphs for the icon-only native buttons. Both are line icons drawn with
// `currentColor` and a stroke, matching ChatGPT's own header icons so they inherit
// the header's text color in both light and dark themes. Each format gets a distinct,
// self-explanatory shape; the exact meaning is announced via the button's title
// tooltip and aria-label.
type IconChild = { tag: 'rect' | 'path'; attrs: Record<string, string> };

function makeIcon(doc: Document, children: ReadonlyArray<IconChild>): SVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  const attrs: Record<string, string> = {
    width: '18',
    height: '18',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  for (const { tag, attrs: childAttrs } of children) {
    const el = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(childAttrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}

// Markdown: the "M + downward chevron" mark inside a rounded badge (the Markdown logo
// silhouette).
function markdownIcon(doc: Document): SVGElement {
  return makeIcon(doc, [
    { tag: 'rect', attrs: { x: '3', y: '6', width: '18', height: '12', rx: '2' } },
    { tag: 'path', attrs: { d: 'M7 15V9l2.5 3L12 9v6' } },
    { tag: 'path', attrs: { d: 'M16 9v5' } },
    { tag: 'path', attrs: { d: 'M14 12l2 2 2-2' } },
  ]);
}

// PDF: a document page with a folded corner and text lines.
function pdfIcon(doc: Document): SVGElement {
  return makeIcon(doc, [
    { tag: 'path', attrs: { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z' } },
    { tag: 'path', attrs: { d: 'M14 3v5h5' } },
    { tag: 'path', attrs: { d: 'M9 13h6' } },
    { tag: 'path', attrs: { d: 'M9 17h6' } },
    { tag: 'path', attrs: { d: 'M9 9h1' } },
  ]);
}

function createButton(
  doc: Document,
  container: HTMLDivElement,
  placement: 'native' | 'overlay',
  { format, label, ariaLabel, icon }: FormatSpec,
  buttonClass: string | undefined,
): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', ariaLabel);
  if (placement === 'native') {
    // Blend in: wear the provider's own icon-button classes (supplied by the adapter
    // so this content layer stays provider-agnostic) and show the format glyph only,
    // matching ChatGPT's square icon controls. The meaning is carried by the tooltip
    // title and aria-label rather than a visible text label.
    if (buttonClass) button.className = buttonClass;
    button.style.cursor = 'pointer';
    button.title = ariaLabel;
    button.appendChild(icon(doc));
  } else {
    // Fallback overlay: fully self-styled so it stays legible even if ChatGPT's CSS
    // never applies.
    button.textContent = label;
    Object.assign(button.style, {
      padding: '6px 12px',
      fontSize: '13px',
      fontFamily: 'inherit',
      color: '#ffffff',
      background: '#10a37f',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
    });
  }
  button.addEventListener('click', () => {
    void runExport(container, format);
  });
  return button;
}

/**
 * Build the export button container. `native` styles the buttons to sit inline
 * inside ChatGPT's header bar; `overlay` is a self-contained fixed pill used only
 * when the header bar cannot be found — anchored bottom-right so it never covers the
 * top-right Share button.
 */
export function createButtons(
  doc: Document,
  placement: 'native' | 'overlay',
  buttonClass?: string,
): HTMLDivElement {
  const container = doc.createElement('div');
  container.id = CONTAINER_ID;
  container.setAttribute(PLACEMENT_ATTR, placement);
  if (placement === 'native') {
    container.className = 'flex items-center';
  } else {
    Object.assign(container.style, {
      position: 'fixed',
      bottom: '12px',
      right: '12px',
      zIndex: '2147483647',
      display: 'flex',
      gap: '6px',
    });
  }
  for (const spec of FORMATS) {
    container.appendChild(createButton(doc, container, placement, spec, buttonClass));
  }
  return container;
}

/**
 * Extract the current conversation and download it in `format`, entirely locally.
 * Fail-loud (AGENTS.md #4): any extraction/export problem surfaces a visible alert
 * and no file is written — never a silent or empty download. A module-level in-flight
 * guard (plus disabling the buttons for feedback) prevents a concurrent export even
 * if the buttons are re-mounted mid-run by an SPA header re-render.
 */
async function runExport(container: HTMLDivElement, format: Format): Promise<void> {
  if (exportInFlight) return;
  exportInFlight = true;
  const buttons = container.querySelectorAll('button');
  buttons.forEach((b) => (b.disabled = true));
  try {
    const adapter = pickAdapter(location.href);
    if (!adapter) {
      alert(EXPORT_NO_ADAPTER_MESSAGE);
      return;
    }
    const conversation = await adapter.extract();
    assertConversationNonEmpty(conversation);
    const now = new Date();
    if (format === 'md') {
      downloadTextFile(markdownFilename(conversation, now), toMarkdown(conversation), 'text/markdown');
    } else {
      // pdfmake + the embedded CJK font are heavy; load them only on demand so an
      // ordinary page visit never pays for them (@crxjs code-splits this import).
      const { downloadPdf } = await import('./pdf-download');
      await downloadPdf(conversation, now);
    }
  } catch (error) {
    // ExtractionError carries a user-actionable message; anything else is
    // unexpected and gets the generic fallback.
    alert(error instanceof ExtractionError ? error.message : EXPORT_FAILED_MESSAGE);
  } finally {
    exportInFlight = false;
    buttons.forEach((b) => (b.disabled = false));
  }
}

/**
 * Trigger a local file download from an in-memory string via an object URL and a
 * transient `<a download>`. No network request (Golden Principle #1). Revocation
 * is deferred to a later task: the browser dispatches the download asynchronously
 * after `click()`, so revoking the object URL in the same tick can cancel an
 * in-flight or large download.
 */
function downloadTextFile(filename: string, text: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Inject (or update) the stylesheet that hides native controls the export buttons
 * supersede. Idempotent: reuses the single `<style>` element and only rewrites it
 * when the selector set changes. With no selectors, any existing rule is removed.
 */
function applyHiddenStyles(doc: Document, selectors: readonly string[] | undefined): void {
  const existing = doc.getElementById(HIDDEN_STYLE_ID);
  if (!selectors || selectors.length === 0) {
    existing?.remove();
    return;
  }
  const css = `${selectors.join(',')}{display:none!important}`;
  if (existing) {
    if (existing.textContent !== css) existing.textContent = css;
    return;
  }
  const style = doc.createElement('style');
  style.id = HIDDEN_STYLE_ID;
  style.textContent = css;
  (doc.head ?? doc.documentElement).appendChild(style);
}

/** Restore any natively-hidden controls by dropping the injected stylesheet. */
function removeHiddenStyles(doc: Document): void {
  doc.getElementById(HIDDEN_STYLE_ID)?.remove();
}

/** Remove the buttons if mounted, and un-hide any controls they had superseded. */
export function removeButtons(doc: Document): void {
  doc.getElementById(CONTAINER_ID)?.remove();
  removeHiddenStyles(doc);
}

export interface SyncOptions {
  /**
   * When the provider's header bar is absent, allow injecting the fallback overlay.
   * The bootstrap only enables this after a grace period, because ChatGPT renders
   * the header asynchronously after a route change — waiting avoids a flash of the
   * overlay before the native bar mounts.
   */
  allowOverlayFallback?: boolean;
}

/**
 * Mount / refresh the export buttons for the current page. Idempotent — safe to
 * call on every navigation tick:
 * - Not a conversation page → remove any mounted buttons.
 * - Conversation page with the provider's header bar present → inject there so the
 *   buttons blend inline with the native Share control.
 * - Header bar absent AND `allowOverlayFallback` → inject a non-overlapping overlay
 *   so the feature still works and never covers Share.
 * - A fallback overlay already mounted but the header bar has since appeared → swap
 *   the overlay out for the native placement so it blends after a late header render.
 * - Otherwise already correctly placed → nothing.
 *
 * Re-injection: when ChatGPT's SPA re-renders the header it drops our node, so the
 * `getElementById` check goes null and the next tick re-injects.
 */
export function syncButtons(doc: Document, href: string, { allowOverlayFallback = false }: SyncOptions = {}): void {
  if (!isConversationPage(href)) {
    removeButtons(doc);
    return;
  }

  const adapter = pickAdapter(href);
  const mount = adapter?.toolbarMount?.(doc) ?? null;

  const existing = doc.getElementById(CONTAINER_ID);
  if (existing) {
    const isOverlay = existing.getAttribute(PLACEMENT_ATTR) === 'overlay';
    // Keep it unless we can upgrade a fallback overlay to the now-available native bar.
    if (!(isOverlay && mount)) return;
    existing.remove();
  }

  if (mount) {
    mount.prepend(createButtons(doc, 'native', adapter?.toolbarButtonClass));
    // Hide the native controls the icon buttons take over (e.g. Share). Persistent
    // stylesheet, so it keeps applying across SPA header re-renders.
    applyHiddenStyles(doc, adapter?.toolbarHiddenSelectors);
  } else if (allowOverlayFallback) {
    // No native header to blend into — the overlay sits apart and hides nothing.
    removeHiddenStyles(doc);
    doc.body.appendChild(createButtons(doc, 'overlay'));
  }
}
