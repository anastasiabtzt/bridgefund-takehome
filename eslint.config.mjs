import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', '.test-dist/**', 'simulator/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
);
