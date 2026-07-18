import { pickAdapter, pickProjectAdapter } from '../adapters';
import type { ConversationAdapter } from '../adapters';
import type { SidebarConversation } from '../core/sidebar';
import { ExtractionError } from '../core/errors';
import { bulkExport, type BulkTarget } from './bulk-export';
import { openBulkPanel } from './bulk-panel';
import { saveConversation, type ExportFormat } from './save-conversation';
import {
  BULK_UNSUPPORTED_MESSAGE,
  DOWNLOAD_BULK_ARIA_LABEL,
  DOWNLOAD_BULK_LABEL,
  DOWNLOAD_HTML_ARIA_LABEL,
  DOWNLOAD_HTML_LABEL,
  DOWNLOAD_JSON_ARIA_LABEL,
  DOWNLOAD_JSON_LABEL,
  DOWNLOAD_MD_ARIA_LABEL,
  DOWNLOAD_MD_LABEL,
  DOWNLOAD_PDF_ARIA_LABEL,
  DOWNLOAD_PDF_LABEL,
  DOWNLOAD_PROJECT_BULK_ARIA_LABEL,
  DOWNLOAD_PROJECT_BULK_LABEL,
  EXPORT_FAILED_MESSAGE,
  EXPORT_NO_ADAPTER_MESSAGE,
} from '../strings';
import { assertConversationNonEmpty } from './guard';
import { isConversationPage, isProjectPage } from './page';
import { DEFAULT_SETTINGS, FORMAT_KEYS, type ToolbarSettings } from '../settings/store';

// Which toolbar controls to render. Defaults to everything-on so the toolbar matches the
// pre-settings behavior until the async load completes (src/content/index.ts swaps in the
// user's stored value and re-mounts). Kept as module state — not a `createButtons` argument
// — because `syncButtons` is called from the navigation poll with no place to thread it.
let cachedSettings: ToolbarSettings = DEFAULT_SETTINGS;

/** Value-equality on the toolbar settings, so a no-op update can skip a needless re-mount. */
function settingsEqual(a: ToolbarSettings, b: ToolbarSettings): boolean {
  return a.bulk === b.bulk && FORMAT_KEYS.every((key) => a.formats[key] === b.formats[key]);
}

/**
 * Update the settings the toolbar renders from. Returns whether the value actually changed,
 * so the caller can skip the removeButtons+re-mount churn when it didn't — which avoids a
 * visible flash of the default buttons on load for the common case where the stored settings
 * equal the all-on default. Callers re-mount to apply only on a real change.
 */
export function setToolbarSettings(settings: ToolbarSettings): boolean {
  const changed = !settingsEqual(cachedSettings, settings);
  cachedSettings = settings;
  return changed;
}

// Stable id on the button container so it is mounted at most once and can be
// located for removal / re-injection.
export const CONTAINER_ID = 'prompt-vault-download-buttons';

// Export formats offered by the toolbar, in display order. The format union itself
// is owned by the headless saver (src/content/save-conversation.ts) so the UI and the
// bulk driver share one type.
interface FormatSpec {
  format: ExportFormat;
  /** Short label; shown only on the self-styled overlay fallback (native is icon-only). */
  label: string;
  ariaLabel: string;
  /** Builds the format's glyph for the icon-only native buttons. */
  icon: (doc: Document) => SVGElement;
}
const FORMATS: ReadonlyArray<FormatSpec> = [
  { format: 'md', label: DOWNLOAD_MD_LABEL, ariaLabel: DOWNLOAD_MD_ARIA_LABEL, icon: markdownIcon },
  { format: 'pdf', label: DOWNLOAD_PDF_LABEL, ariaLabel: DOWNLOAD_PDF_ARIA_LABEL, icon: pdfIcon },
  { format: 'json', label: DOWNLOAD_JSON_LABEL, ariaLabel: DOWNLOAD_JSON_ARIA_LABEL, icon: jsonIcon },
  { format: 'html', label: DOWNLOAD_HTML_LABEL, ariaLabel: DOWNLOAD_HTML_ARIA_LABEL, icon: htmlIcon },
];

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

// JSON: curly braces, the universal glyph for structured data.
function jsonIcon(doc: Document): SVGElement {
  return makeIcon(doc, [
    { tag: 'path', attrs: { d: 'M8 4a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2' } },
    { tag: 'path', attrs: { d: 'M16 4a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2' } },
  ]);
}

// HTML: an angle-bracket tag mark (`< >` with a slash), the universal glyph for markup.
function htmlIcon(doc: Document): SVGElement {
  return makeIcon(doc, [
    { tag: 'path', attrs: { d: 'M8 8l-4 4 4 4' } },
    { tag: 'path', attrs: { d: 'M16 8l4 4-4 4' } },
    { tag: 'path', attrs: { d: 'M13 6l-2 12' } },
  ]);
}

// Bulk: two overlapping document sheets — the universal "multiple items" glyph —
// distinguishing this action (pick several conversations) from the single-format
// download buttons beside it. Meaning is announced via the tooltip title and aria-label.
function bulkIcon(doc: Document): SVGElement {
  return makeIcon(doc, [
    { tag: 'rect', attrs: { x: '9', y: '3', width: '11', height: '13', rx: '2' } },
    { tag: 'path', attrs: { d: 'M5 8v11a2 2 0 0 0 2 2h9' } },
  ]);
}

/** Shared shape for every toolbar button (per-format download and the bulk action). */
interface ButtonSpec {
  label: string;
  ariaLabel: string;
  icon: (doc: Document) => SVGElement;
  onClick: () => void;
}

function createButton(
  doc: Document,
  placement: 'native' | 'overlay',
  { label, ariaLabel, icon, onClick }: ButtonSpec,
  buttonClass: string | undefined,
): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', ariaLabel);
  if (placement === 'native') {
    // Blend in: wear the provider's own icon-button classes (supplied by the adapter
    // so this content layer stays provider-agnostic) and show the glyph only, matching
    // ChatGPT's square icon controls. The meaning is carried by the tooltip title and
    // aria-label rather than a visible text label.
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
  button.addEventListener('click', onClick);
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
    // `gap-0.5` keeps the two icon buttons from abutting so their hover highlights
    // don't touch — matching the spacing of ChatGPT's own header controls.
    container.className = 'flex items-center gap-0.5';
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
  // Render only the formats the user kept enabled (all of them by default). At least one
  // is always enabled — the store's sanitize() guarantees it — so this never yields an
  // export-less toolbar.
  for (const spec of FORMATS.filter((spec) => cachedSettings.formats[spec.format])) {
    const buttonSpec: ButtonSpec = { ...spec, onClick: () => void runExport(container, spec.format) };
    container.appendChild(createButton(doc, placement, buttonSpec, buttonClass));
  }
  // The bulk action sits after the per-format buttons: it opens a selection panel
  // instead of downloading the current conversation, so it carries its own handler.
  // Shown only when the user keeps the bulk icon enabled.
  if (cachedSettings.bulk) {
    const bulkSpec: ButtonSpec = {
      label: DOWNLOAD_BULK_LABEL,
      ariaLabel: DOWNLOAD_BULK_ARIA_LABEL,
      icon: bulkIcon,
      onClick: () => openBulkExport(doc),
    };
    container.appendChild(createButton(doc, placement, bulkSpec, buttonClass));
  }
  return container;
}

/**
 * Build the project bulk-download trigger container: a single labeled "Download all"
 * button that stands alone in the project page body (or as an overlay). `native` wears
 * the provider's own labeled-button classes (`buttonClass`, supplied by the adapter so
 * this content layer stays provider-agnostic) and mirrors the provider's icon+label
 * inner layout, so it blends with the page's native controls (e.g. the Share button)
 * and adapts to light/dark. `overlay` is a fully self-styled non-overlapping fixed pill
 * used when the list section is not found — legible even without the host CSS.
 */
export function createProjectTrigger(
  doc: Document,
  placement: 'native' | 'overlay',
  buttonClass?: string,
): HTMLDivElement {
  const container = doc.createElement('div');
  container.id = CONTAINER_ID;
  container.setAttribute(PLACEMENT_ATTR, placement);

  const button = doc.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', DOWNLOAD_PROJECT_BULK_ARIA_LABEL);
  button.title = DOWNLOAD_PROJECT_BULK_ARIA_LABEL;

  if (placement === 'native') {
    // Right-align the trigger at the top of the conversation-list section.
    Object.assign(container.style, { display: 'flex', justifyContent: 'flex-end', padding: '8px 12px' });
    // Wear the provider's labeled-button classes (theme-aware, matches native controls).
    if (buttonClass) button.className = buttonClass;
    button.style.cursor = 'pointer';
    // Mirror the provider's icon+label inner layout (a centered flex row with a small gap).
    const inner = doc.createElement('div');
    inner.className = 'flex items-center justify-center gap-1.5';
    inner.appendChild(bulkIcon(doc));
    const label = doc.createElement('span');
    label.textContent = DOWNLOAD_PROJECT_BULK_LABEL;
    inner.appendChild(label);
    button.appendChild(inner);
  } else {
    Object.assign(container.style, {
      position: 'fixed',
      bottom: '12px',
      right: '12px',
      zIndex: '2147483647',
      display: 'flex',
    });
    Object.assign(button.style, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
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
    // The bulk glyph draws with `currentColor`, so it renders white on the green pill.
    button.appendChild(bulkIcon(doc));
    const label = doc.createElement('span');
    label.textContent = DOWNLOAD_PROJECT_BULK_LABEL;
    button.appendChild(label);
  }

  button.addEventListener('click', () => openProjectBulkExport(doc));
  container.appendChild(button);
  return container;
}

/**
 * Extract the current conversation and download it in `format`, entirely locally.
 * Fail-loud (AGENTS.md #4): any extraction/export problem surfaces a visible alert
 * and no file is written — never a silent or empty download. A module-level in-flight
 * guard (plus disabling the buttons for feedback) prevents a concurrent export even
 * if the buttons are re-mounted mid-run by an SPA header re-render.
 */
async function runExport(container: HTMLDivElement, format: ExportFormat): Promise<void> {
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
    // Produce+save lives in the headless saver so the bulk driver reuses it.
    await saveConversation(conversation, format, new Date());
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
 * Open the bulk-export selection panel for the current conversation page, wired to the
 * adapter's history-sidebar enumeration and cross-conversation navigation. Fail-loud
 * (AGENTS.md #4): if the adapter cannot list or open conversations, surface a visible
 * message instead of an empty panel. Blocked while a single export is in flight.
 */
function openBulkExport(doc: Document): void {
  if (exportInFlight) return;
  const adapter = pickAdapter(location.href);
  if (!adapter) {
    alert(EXPORT_NO_ADAPTER_MESSAGE);
    return;
  }
  // Bulk needs both sidebar enumeration and cross-conversation navigation; a provider
  // that implements neither cannot be bulk-exported. Call through `adapter.` (rather
  // than destructuring the methods) so they keep their `this` binding.
  if (!adapter.listConversations || !adapter.openConversation) {
    alert(BULK_UNSUPPORTED_MESSAGE);
    return;
  }

  driveBulkPanel(doc, adapter, {
    list: () => adapter.listConversations!(doc),
    open: (url) => adapter.openConversation!(url),
    // Return the user to the conversation they started from once the batch settles.
    returnToStart: (startUrl) => adapter.openConversation!(startUrl),
  });
}

/**
 * Open the same selection panel for a Project home page, wired to the adapter's
 * project-list enumeration and project-conversation navigation. Fail-loud like
 * `openBulkExport`. After the batch the user is returned to the project home.
 */
function openProjectBulkExport(doc: Document): void {
  if (exportInFlight) return;
  const adapter = pickProjectAdapter(location.href);
  if (!adapter) {
    alert(EXPORT_NO_ADAPTER_MESSAGE);
    return;
  }
  if (!adapter.listProjectConversations || !adapter.openProjectConversation) {
    alert(BULK_UNSUPPORTED_MESSAGE);
    return;
  }

  driveBulkPanel(doc, adapter, {
    list: () => adapter.listProjectConversations!(doc),
    open: (url) => adapter.openProjectConversation!(url),
    // Navigate back to the project the run started from (`startUrl`); best-effort, so a
    // provider without it is fine.
    returnToStart: (startUrl) => adapter.openProjectHome?.(startUrl) ?? Promise.resolve(),
  });
}

/** The track-specific pieces the shared bulk driver needs (enumerate / open / return). */
interface BulkTrack {
  list: () => SidebarConversation[];
  open: (url: string) => Promise<void>;
  /** Return the user to `startUrl` (or a home page) once the batch settles. */
  returnToStart: (startUrl: string) => Promise<void>;
}

/**
 * Shared bulk-export driver for both the history and project tracks: opens the
 * provider-agnostic selection panel and, on run, produces+saves each selected
 * conversation via the track's navigation, isolating per-item failures in the summary.
 * Holds the in-flight guard for the whole batch so a stray single-export short-circuits.
 */
function driveBulkPanel(doc: Document, adapter: ConversationAdapter, track: BulkTrack): void {
  openBulkPanel(doc, {
    listConversations: track.list,
    run: async (selected, format, onProgress) => {
      exportInFlight = true;
      const startUrl = location.href;
      const targets: BulkTarget[] = selected.map((sidebar) => ({
        title: sidebar.title,
        produce: async () => {
          await track.open(sidebar.url);
          const conversation = await adapter.extract();
          assertConversationNonEmpty(conversation);
          return conversation;
        },
      }));
      try {
        return await bulkExport(targets, format, new Date(), { onProgress });
      } finally {
        // Return the user BEFORE releasing the guard, so a stray single-export can't fire
        // against the last-exported conversation mid-navigation. Best-effort — a nav
        // failure does not affect the batch result (files are already saved), so it is
        // swallowed; a console.warn leaves a breadcrumb for why the tab stayed put
        // instead of returning, without a disruptive alert.
        await track.returnToStart(startUrl).catch((error: unknown) => {
          console.warn('prompt-vault: could not return after bulk export', error);
        });
        exportInFlight = false;
      }
    },
  });
}

/** Remove the buttons if mounted. */
export function removeButtons(doc: Document): void {
  doc.getElementById(CONTAINER_ID)?.remove();
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
 * - Native buttons already mounted → re-assert their position, since the Share anchor
 *   may have rendered (or moved) after our first mount in a staged SPA header render.
 * - Otherwise already correctly placed → nothing.
 *
 * Re-injection: when ChatGPT's SPA re-renders the header it drops our node, so the
 * `getElementById` check goes null and the next tick re-injects.
 */
export function syncButtons(doc: Document, href: string, { allowOverlayFallback = false }: SyncOptions = {}): void {
  if (isConversationPage(href)) {
    syncConversationButtons(doc, href, allowOverlayFallback);
  } else if (isProjectPage(href)) {
    syncProjectTrigger(doc, href, allowOverlayFallback);
  } else {
    removeButtons(doc);
  }
}

/** Mount/refresh the per-conversation export toolbar (format buttons + bulk icon). */
function syncConversationButtons(doc: Document, href: string, allowOverlayFallback: boolean): void {
  const adapter = pickAdapter(href);
  const mount = adapter?.toolbarMount?.(doc) ?? null;
  const anchor = mount ? adapter?.toolbarAnchor?.(mount) ?? null : null;

  const existing = doc.getElementById(CONTAINER_ID);
  if (existing) {
    const isOverlay = existing.getAttribute(PLACEMENT_ATTR) === 'overlay';
    if (isOverlay && mount) {
      // Upgrade the fallback overlay to the now-available native bar.
      existing.remove();
    } else {
      // Already natively placed: re-assert the position in case the Share anchor
      // rendered after our first mount (staged SPA header render), so the buttons
      // don't get stranded away from Share's left. No-op when already correct.
      if (!isOverlay && mount) positionBeforeAnchor(existing, mount, anchor);
      return;
    }
  }

  if (mount) {
    positionBeforeAnchor(createButtons(doc, 'native', adapter?.toolbarButtonClass), mount, anchor);
  } else if (allowOverlayFallback) {
    doc.body.appendChild(createButtons(doc, 'overlay'));
  }
}

/**
 * Mount/refresh the Project home page's single "Download all" trigger. Mirrors the
 * conversation-toolbar sync (overlay grace, overlay→native upgrade), but the native
 * mount is the project's conversation-list section (the trigger is prepended into it)
 * rather than a header bar with a Share anchor.
 */
function syncProjectTrigger(doc: Document, href: string, allowOverlayFallback: boolean): void {
  // The "bulk" toolbar setting governs bulk-export UI overall; when the user has turned
  // it off, hide the project trigger too (not just the per-conversation bulk icon), so the
  // setting behaves consistently across pages rather than silently ignoring it here.
  if (!cachedSettings.bulk) {
    removeButtons(doc);
    return;
  }

  const adapter = pickProjectAdapter(href);
  const mount = adapter?.projectToolbarMount?.(doc) ?? null;

  const existing = doc.getElementById(CONTAINER_ID);
  if (existing) {
    const isOverlay = existing.getAttribute(PLACEMENT_ATTR) === 'overlay';
    if (isOverlay && mount) {
      // Upgrade the fallback overlay to the now-available native section.
      existing.remove();
    } else {
      // Native and already placed: re-assert it as the section's first child in case
      // the list re-rendered around it. No-op when already correct.
      if (!isOverlay && mount && mount.firstElementChild !== existing) mount.prepend(existing);
      return;
    }
  }

  if (mount) {
    mount.prepend(createProjectTrigger(doc, 'native', adapter?.projectToolbarButtonClass));
  } else if (allowOverlayFallback) {
    doc.body.appendChild(createProjectTrigger(doc, 'overlay'));
  }
}

/**
 * Place `container` immediately to the left of the Share `anchor` inside `mount`
 * (before whichever direct child of the bar contains the anchor), or at the front of
 * the bar when the anchor is absent. Idempotent: moves the node only when it is not
 * already in the right spot, so it doubles as both the initial insert and a
 * re-assert on later ticks.
 */
function positionBeforeAnchor(container: HTMLElement, mount: Element, anchor: Element | null): void {
  const before = directChildContaining(mount, anchor);
  if (before) {
    if (container.nextElementSibling !== before) mount.insertBefore(container, before);
  } else if (mount.firstElementChild !== container) {
    mount.prepend(container);
  }
}

/**
 * The direct child of `parent` that is (or contains) `node`, or null if `node` is
 * absent or not within `parent`. Lets us insert before a control even when it is
 * nested a few levels below the header bar.
 */
function directChildContaining(parent: Element, node: Element | null): Element | null {
  let current: Element | null = node;
  while (current && current.parentElement !== parent) {
    current = current.parentElement;
  }
  return current;
}
