import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BUNDLE = path.join(__dirname, '../../dist/commitView.js');

// Same JSX-runtime regression guard as webviewMount, for the commit bundle.
describe('commit view bundle mounts', () => {
  it('renders the commit app root without runtime errors', async () => {
    if (!fs.existsSync(BUNDLE)) throw new Error('dist/commitView.js missing — run `npm run build` first');
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

    expect(window.document.querySelector('.commit-app')).not.toBeNull();
    expect(errors.join('\n')).not.toContain('React is not defined');
  });
});
