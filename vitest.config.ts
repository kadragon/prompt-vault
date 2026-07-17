import { defineConfig } from 'vitest/config'

// Deliberately separate from vite.config.ts: the @crxjs/vite-plugin needs a
// browser/extension build context and must NOT run during unit tests. Exporters
// and pure helpers (e.g. isConversationPage) are tested in a plain node env.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
