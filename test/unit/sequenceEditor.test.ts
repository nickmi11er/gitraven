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

describe('buildSteps log format against real git', () => {
  it('carries the full message (subject + body) per record', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'detached-steps-'));
    const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'T');
    git('config', 'user.email', 't@t');
    const commit = (file: string, subject: string, body?: string) => {
      fs.writeFileSync(path.join(repo, file), subject);
      git('add', '.');
      const args = ['commit', '-q', '-m', subject];
      if (body) args.push('-m', body);
      git(...args);
    };
    commit('base.txt', 'base');
    commit('a.txt', 'subject one', 'body line 1\nbody line 2');
    commit('b.txt', 'subject two');

    // Same command and parsing as RebaseController.buildSteps.
    const stdout = git('log', '--reverse', '--topo-order', '--format=%H\x1f%s\x1f%B\x1e', 'HEAD~2..HEAD');
    const steps: { sha: string; subject: string; original: string }[] = [];
    for (const record of stdout.split('\x1e')) {
      const trimmed = record.replace(/^\n+/, '');
      if (!trimmed.trim()) continue;
      const [sha, subject, ...body] = trimmed.split('\x1f');
      steps.push({ sha, subject: subject ?? '', original: body.join('\x1f').replace(/\n+$/, '') });
    }

    expect(steps).toHaveLength(2);
    expect(steps[0].subject).toBe('subject one');
    expect(steps[0].original).toBe('subject one\n\nbody line 1\nbody line 2');
    expect(steps[1].subject).toBe('subject two');
    expect(steps[1].original).toBe('subject two');
    fs.rmSync(repo, { recursive: true, force: true });
  });
});
