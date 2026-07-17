// Shared signal name used to bridge the MAIN-world navigation hook (nav-hook.ts)
// and the isolated-world content script (index.ts). Only a bare DOM event
// crosses the world boundary — no conversation data.
export const NAV_EVENT = 'prompt-vault:navigation';
