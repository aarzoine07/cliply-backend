// Stage A ESLint config – keep CI green without enforcing strict rules yet

module.exports = {
    root: true,
    env: {
      node: true,
      es2022: true,
    },
    parser: '@typescript-eslint/parser',
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    // For now we are NOT extending any strict rule sets.
    // This is intentional: Stage A is "lint wiring + CI green", not "clean up 800+ issues".
    extends: [],
    plugins: ['@typescript-eslint'],
    ignorePatterns: [
      'node_modules/',
      'dist/',
      'coverage/',
      'supabase/',
      '.next/',
      'apps/**/.next/**',
      'apps/**/out/**',
      // We are temporarily ignoring all tests & scripts in Stage A
      'test/**',
      'apps/**/test/**',
      'scripts/**',
    ],
    rules: {
      // Keep everything effectively off for now.
      'no-constant-condition': 'off',
      'no-useless-escape': 'off',
      'prefer-const': 'off',
  
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  };