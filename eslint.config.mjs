import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', '.test-dist/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['simulator/**/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly' } } },
);
