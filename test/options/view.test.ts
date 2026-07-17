import { describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { renderOptions } from '../../src/options/view';
import { DEFAULT_SETTINGS, type ToolbarSettings } from '../../src/settings/store';

// Build a parsed document with an #app mount and a spy `save`, render the form into it, and
// return handles the tests drive. happy-dom gives real change events without a browser.
// `saveResult` lets a test make the injected save reject, to exercise the fail-loud note.
function mount(
  settings: ToolbarSettings = DEFAULT_SETTINGS,
  saveResult: () => Promise<void> = () => Promise.resolve(),
): {
  doc: Document;
  saved: ToolbarSettings[];
  box: (id: string) => HTMLInputElement;
  note: () => string;
  fireChange: (input: HTMLInputElement, checked: boolean) => void;
} {
  const window = new Window();
  window.document.write('<body><main id="app"></main></body>');
  const doc = window.document as unknown as Document;
  const app = doc.getElementById('app')!;
  const saved: ToolbarSettings[] = [];
  renderOptions(doc, app, settings, (s) => {
    saved.push(s);
    return saveResult();
  });

  const box = (id: string): HTMLInputElement => doc.getElementById(id) as HTMLInputElement;
  const fireChange = (input: HTMLInputElement, checked: boolean): void => {
    input.checked = checked;
    input.dispatchEvent(new window.Event('change') as unknown as Event);
  };
  return { doc, saved, box, note: () => doc.getElementById('note')?.textContent ?? '', fireChange };
}

// The saved/failed note is set from a promise handler, so flush microtasks before asserting it.
const flush = (): Promise<void> => Promise.resolve().then(() => undefined);

describe('renderOptions', () => {
  it('renders a checkbox per format plus the bulk toggle, reflecting the current settings', () => {
    const { box } = mount({ formats: { md: true, pdf: false, json: true, html: false }, bulk: false });
    expect(box('format-md').checked).toBe(true);
    expect(box('format-pdf').checked).toBe(false);
    expect(box('format-json').checked).toBe(true);
    expect(box('format-html').checked).toBe(false);
    expect(box('bulk').checked).toBe(false);
  });

  it('persists a snapshot on each change (not the live working copy)', () => {
    const { box, saved, fireChange } = mount();
    fireChange(box('format-pdf'), false);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual({ formats: { md: true, pdf: false, json: true, html: true }, bulk: true });
    // A later change must not retroactively mutate the earlier snapshot.
    fireChange(box('format-json'), false);
    expect(saved[0].formats.json).toBe(true);
  });

  it('toggles the bulk icon independently of the format rule', () => {
    const { box, saved, fireChange } = mount();
    fireChange(box('bulk'), false);
    expect(saved).toHaveLength(1);
    expect(saved[0].bulk).toBe(false);
  });

  it('blocks unchecking the last remaining format: reverts the box, shows a note, does not save', () => {
    const { box, saved, note, fireChange } = mount();
    // Disable three of four — all valid.
    fireChange(box('format-pdf'), false);
    fireChange(box('format-json'), false);
    fireChange(box('format-html'), false);
    expect(saved).toHaveLength(3);

    // Attempt to disable the last one (md) — must be rejected.
    fireChange(box('format-md'), false);
    expect(box('format-md').checked).toBe(true); // reverted
    expect(saved).toHaveLength(3); // no extra save
    expect(note()).toBe('At least one export format must stay enabled.');
  });

  it('shows the saved note only after the save resolves', async () => {
    const { box, note, fireChange } = mount();
    fireChange(box('format-pdf'), false);
    // Note is set from the resolved-promise handler, so it is empty until microtasks flush.
    expect(note()).toBe('');
    await flush();
    expect(note()).toBe('Saved.');
  });

  it('shows a fail-loud note (not "Saved.") when the save rejects', async () => {
    const { box, note, fireChange } = mount(DEFAULT_SETTINGS, () => Promise.reject(new Error('quota')));
    fireChange(box('format-pdf'), false);
    await flush();
    expect(note()).toBe('Could not save. Please try again.');
  });
});
