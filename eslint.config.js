// ESLint v9 flat config for Cliply backend (TS + Prettier-friendly)
import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";
import globals from "globals";

/** @type {import("eslint").Linter.FlatConfig[]} */
export default [
  // Ignore build artifacts
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**"] },

  // JS baseline
  {
    files: ["**/*.js"],
    ...js.configs.recommended,
    languageOptions: {
      globals: globals.node, // <-- allow console, process, __dirname, etc.
    },
  },

  // TypeScript rules
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
      globals: globals.node, // <-- Node globals for TS too
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      import: importPlugin,
    },
    rules: {
      "import/order": ["warn", { "newlines-between": "always", alphabetize: { order: "asc" } }],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  // Disable stylistic rules that fight Prettier
  prettier,
];
