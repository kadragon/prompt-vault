import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Type-aware linting: resolve each file to its tsconfig automatically.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
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
  {
    // This flat-config file is plain JS and outside the app tsconfig graph;
    // turn off type-checked rules for it so lint doesn't error on missing type
    // information for the config itself.
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Node build/packaging scripts: plain ESM, outside the app tsconfig graph.
    // Disable type-checked rules and expose the Node globals they use.
    files: ['scripts/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
);
