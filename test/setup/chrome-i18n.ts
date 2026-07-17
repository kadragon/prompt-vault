// Vitest runs in a plain node environment, so there is no real chrome.i18n. This
// shim resolves getMessage() against the actual en catalog so src/strings.ts
// (evaluated at import time) sees real English strings rather than empty ones.
import en from '../../public/_locales/en/messages.json';

interface MessageEntry {
  message: string;
  placeholders?: Record<string, { content: string }>;
}

const catalog = en as unknown as Record<string, MessageEntry>;

function getMessage(key: string, substitutions?: string[]): string {
  const entry = catalog[key];
  if (!entry) return '';

  if (!entry.placeholders) return entry.message;

  const resolved: Record<string, string> = {};
  for (const [name, { content }] of Object.entries(entry.placeholders)) {
    const match = /^\$(\d+)$/.exec(content);
    const index = match ? Number(match[1]) - 1 : NaN;
    resolved[name.toLowerCase()] = Number.isNaN(index) ? '' : (substitutions?.[index] ?? '');
  }

  return entry.message.replace(/\$(\w+)\$/gi, (token, name: string) => {
    const value = resolved[name.toLowerCase()];
    return value !== undefined ? value : token;
  });
}

const g = globalThis as unknown as { chrome: { i18n: { getMessage: typeof getMessage } } };
g.chrome = { ...g.chrome, i18n: { getMessage } };
