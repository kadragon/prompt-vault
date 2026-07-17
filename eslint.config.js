import tseslint from 'typescript-eslint';

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
    rules: {
      // Mechanically enforce one semicolon style across the codebase
      // (mechanical enforcement > verbal agreement).
      semi: ['error', 'always'],
    },
  },
);
