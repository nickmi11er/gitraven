import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Match the extension's esbuild config: use the automatic JSX runtime so
  // .tsx test files don't need React in scope.
  esbuild: { jsx: 'automatic' },
});
