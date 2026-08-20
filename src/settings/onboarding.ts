// First-run onboarding state: whether the user has already seen (and dismissed) the in-page
// coach mark that points at the browser toolbar. Persisted in chrome.storage.local rather than
// .sync because it describes THIS browser's toolbar — pinning is per-profile/per-browser, so a
// dismissal should not roam to a machine where the icon is still unpinned.
//
// Fail-safe direction is the opposite of src/settings/store.ts: there, a malformed value degrades
// to "show everything"; here it degrades to "stay silent". Repeatedly nagging a user who already
// dismissed the card is worse than never showing it, so any storage failure reads as dismissed.

// Storage key under which the dismissal flag lives in chrome.storage.local.
const STORAGE_KEY = 'coachMarkDismissed';

/**
 * Coerce an arbitrary stored value into the dismissal flag. Anything that is not a boolean
 * (absent, malformed, a truthy string from an older build) means "not yet dismissed", so a
 * fresh install still gets exactly one coach mark.
 */
export function sanitizeDismissed(raw: unknown): boolean {
  return typeof raw === 'boolean' ? raw : false;
}

/**
 * Whether the coach mark has already been dismissed. Never rejects: a failed storage read
 * resolves to `true` (treat as dismissed) so a storage problem can neither break the caller
 * nor turn into a card the user cannot get rid of.
 */
export async function isCoachMarkDismissed(): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return sanitizeDismissed(stored[STORAGE_KEY]);
  } catch {
    return true;
  }
}

/**
 * Persist the dismissal. Never rejects: the card is already gone from the DOM by the time this
 * runs, so a write failure must not throw into a DOM event handler. Worst case the user sees the
 * card once more on a later page load.
 */
export async function markCoachMarkDismissed(): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: true });
  } catch {
    // Intentionally swallowed — see above.
  }
}

/**
 * Call `onDismissed` when ANOTHER context — a second tab on a supported site, the same site in a
 * second window — persists the dismissal. Each tab runs its own content script and reads the flag
 * independently, so two tabs opened before either card is dismissed each arm and show one; without
 * this, dismissing in one leaves the other's card up until the tab is reloaded. Storage failures
 * are not this listener's problem: `chrome.storage.onChanged` only reports writes that succeeded.
 */
export function subscribeCoachMarkDismissed(onDismissed: () => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (sanitizeDismissed(changes[STORAGE_KEY]?.newValue)) onDismissed();
  });
}
