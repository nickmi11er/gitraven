import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BUNDLE = path.join(__dirname, '../../dist/webview.js');

// Guards against the JSX-runtime regression: if esbuild emits the classic
// transform (React.createElement) while the .tsx files don't import React, the
// bundle throws `React is not defined` at load and the webview renders blank.
// Requires `npm run build` first (CI builds before testing).
describe('webview bundle mounts', () => {
  it('renders the React app root without runtime errors', async () => {
    if (!fs.existsSync(BUNDLE)) throw new Error('dist/webview.js missing — run `npm run build` first');
    const bundle = fs.readFileSync(BUNDLE, 'utf8');

    const errors: string[] = [];
    const vc = new VirtualConsole();
    vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
    vc.on('jsdomError', (e) => errors.push(e.message));

    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      virtualConsole: vc,
    });
    const { window } = dom;
    (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
      postMessage() {},
      getState() {},
      setState() {},
    });
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };

    window.eval(bundle);
    await new Promise((r) => setTimeout(r, 150));

    const root = window.document.getElementById('root');
    expect(root?.querySelector('.app')).not.toBeNull();
    expect(root?.querySelector('.split-pane')).not.toBeNull();
    expect(errors.join('\n')).not.toContain('React is not defined');
  });
});
