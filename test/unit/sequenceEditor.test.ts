import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const HELPER = path.join(__dirname, '../../dist/helpers/sequenceEditor.cjs');

// Requires `npm run build` first (CI builds before testing).
describe('sequenceEditor todo rendering', () => {
  it('renders pick/reword/edit/squash/fixup and omits drop', () => {
    if (!fs.existsSync(HELPER)) {
      throw new Error('dist/helpers/sequenceEditor.cjs missing — run `npm run build` first');
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'detached-seq-'));
    const msgDir = path.join(dir, 'msgs');
    fs.mkdirSync(msgDir);
    const plan = {
      steps: [
        { id: 0, sha: 'aaa0', action: 'pick', hasMessage: false },
        { id: 1, sha: 'bbb1', action: 'reword', hasMessage: true },
        { id: 2, sha: 'ccc2', action: 'edit', hasMessage: false },
        { id: 3, sha: 'ddd3', action: 'squash', hasMessage: true },
        { id: 4, sha: 'eee4', action: 'fixup', hasMessage: false },
        { id: 5, sha: 'fff5', action: 'drop', hasMessage: false },
      ],
      execPrefix: '"node" "messageEditor.cjs"',
      msgDir,
    };
    const planPath = path.join(dir, 'plan.json');
    fs.writeFileSync(planPath, JSON.stringify(plan));
    const todoPath = path.join(dir, 'git-rebase-todo');
    fs.writeFileSync(todoPath, 'placeholder\n');

    execFileSync(process.execPath, [HELPER, todoPath], {
      env: { ...process.env, DETACHED_REBASE_PLAN: planPath },
    });

    const lines = fs.readFileSync(todoPath, 'utf8').trim().split('\n');
    expect(lines[0]).toBe('pick aaa0');
    expect(lines[1]).toBe('pick bbb1');
    expect(lines[2]).toContain('exec "node" "messageEditor.cjs" --msg');
    expect(lines[2]).toContain('msg-1.txt');
    expect(lines[3]).toBe('edit ccc2');
    expect(lines[4]).toBe('squash ddd3');
    expect(lines[5]).toContain('msg-3.txt');
    expect(lines[6]).toBe('fixup eee4');
    expect(lines.some((l) => l.includes('fff5'))).toBe(false); // drop omitted
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
