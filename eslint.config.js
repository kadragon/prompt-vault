import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        // Content scripts run with the extension APIs on the page.
        chrome: 'readonly',
      },
    },
  },
)
