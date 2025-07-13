// ESLint v9+ flat config
import js from '@eslint/js';

/** @type {import('eslint').FlatConfig[]} */
export default [
  js.config({
    env: {
      browser: true,
      es2021: true,
      node: true,
    },
  }),
  {
    ignores: [
      'node_modules/',
      'dist/',
      'build/',
      '.env',
    ],
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'error',
      'no-console': 'off',
      semi: ['error', 'always'],
      quotes: ['error', 'single'],
    },
  },
];
