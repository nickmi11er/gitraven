import * as vscode from 'vscode';
import { spawn } from 'node:child_process';

let cached: { path: string; version: string } | undefined;

/**
 * Resolve the git executable: honour `gitraven.gitPath`, fall back to the
 * built-in `vscode.git` extension's detected path, then plain `git` on PATH.
 * The resolved binary is probed with `--version` and cached.
 */
export async function resolveGit(): Promise<{ path: string; version: string }> {
  if (cached) return cached;

  const candidates: string[] = [];
  const configured = vscode.workspace.getConfiguration('gitraven').get<string>('gitPath')?.trim();
  if (configured) candidates.push(configured);

  const builtin = builtinGitPath();
  if (builtin) candidates.push(builtin);

  candidates.push('git');

  for (const candidate of candidates) {
    const version = await probe(candidate);
    if (version) {
      cached = { path: candidate, version };
      return cached;
    }
  }
  throw new Error('Unable to locate a working git executable. Set "gitraven.gitPath" in settings.');
}

export function resetGitPathCache(): void {
  cached = undefined;
}

/** Parsed [major, minor, patch] of the resolved git, for feature gating. */
export function parseVersion(version: string): [number, number, number] {
  const m = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function builtinGitPath(): string | undefined {
  try {
    const ext = vscode.extensions.getExtension<{ getAPI(v: 1): { git: { path: string } } }>('vscode.git');
    return ext?.isActive ? ext.exports.getAPI(1).git.path : undefined;
  } catch {
    return undefined;
  }
}

function probe(path: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    let out = '';
    try {
      const child = spawn(path, ['--version'], { shell: false });
      child.stdout.on('data', (d) => (out += d.toString()));
      child.on('error', () => resolve(undefined));
      child.on('close', (code) => {
        const m = out.match(/git version (\S+)/);
        resolve(code === 0 && m ? m[1] : undefined);
      });
    } catch {
      resolve(undefined);
    }
  });
}
