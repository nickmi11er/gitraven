import { build, context } from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : 'inline',
  logLevel: 'info',
};

const targets = [
  {
    ...common,
    entryPoints: { extension: 'src/extension/extension.ts' },
    outdir: 'dist',
    outExtension: { '.js': '.cjs' },
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
  },
  {
    ...common,
    entryPoints: {
      sequenceEditor: 'src/editor-helper/sequenceEditor.ts',
      messageEditor: 'src/editor-helper/messageEditor.ts',
      noopEditor: 'src/editor-helper/noopEditor.ts',
    },
    outdir: 'dist/helpers',
    outExtension: { '.js': '.cjs' },
    platform: 'node',
    format: 'cjs',
    target: 'node18',
  },
  {
    ...common,
    entryPoints: { webview: 'src/webview/main.tsx' },
    outdir: 'dist',
    platform: 'browser',
    format: 'iife',
    target: 'es2021',
    // Use the automatic JSX runtime (esbuild otherwise defaults to the classic
    // transform, which emits React.createElement and needs React in scope — the
    // .tsx files don't import React, so that would ReferenceError at runtime).
    jsx: 'automatic',
    jsxDev: !production,
    loader: { '.css': 'css', '.ttf': 'file' },
  },
];

if (watch) {
  const contexts = await Promise.all(targets.map((t) => context(t)));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('[esbuild] watching…');
} else {
  await Promise.all(targets.map((t) => build(t)));
  console.log('[esbuild] build complete');
}
