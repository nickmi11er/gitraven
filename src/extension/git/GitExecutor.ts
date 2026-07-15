import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import { resolveGit } from './gitPath';
import { GitError } from './GitError';
import { log } from '../util/logger';

export interface ExecOptions {
  cwd: string;
  /** Written to stdin, then stdin is closed. */
  input?: string;
  /** Extra environment merged over `process.env`. */
  env?: NodeJS.ProcessEnv;
  token?: vscode.CancellationToken;
  timeoutMs?: number;
  /** Skip the injected `-c core.quotepath=false …` flags (rarely needed). */
  raw?: boolean;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const STANDARD_CONFIG = [
  '-c', 'core.quotepath=false',
  '-c', 'color.ui=false',
  '-c', 'core.pager=cat',
  '-c', 'core.editor=true',
];

function fullArgs(args: string[], raw: boolean | undefined): string[] {
  return raw ? args : [...STANDARD_CONFIG, ...args];
}

/** Buffered execution. Rejects with {@link GitError} on non-zero exit. */
export async function exec(args: string[], opts: ExecOptions): Promise<ExecResult> {
  const { path } = await resolveGit();
  const finalArgs = fullArgs(args, opts.raw);
  return new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(path, finalArgs, {
      cwd: opts.cwd,
      shell: false,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let settled = false;

    const cancelSub = opts.token?.onCancellationRequested(() => {
      child.kill();
    });
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill();
        }, opts.timeoutMs)
      : undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      cancelSub?.dispose();
    };

    child.stdout.on('data', (d: Buffer) => outChunks.push(d));
    child.stderr.on('data', (d: Buffer) => errChunks.push(d));

    if (opts.input !== undefined) {
      // git may close stdin early (e.g. it has enough input); swallow the EPIPE
      // so it doesn't surface as an unhandled stream error.
      child.stdin.on('error', () => undefined);
      child.stdin.end(opts.input);
    }

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      const stdout = Buffer.concat(outChunks).toString('utf8');
      const stderr = Buffer.concat(errChunks).toString('utf8');
      if (code === 0) {
        resolve({ stdout, stderr, exitCode: 0 });
      } else {
        const command = `git ${finalArgs.join(' ')}`;
        log.warn(`${command} (cwd=${opts.cwd}) exited ${code}: ${stderr.trim()}`);
        reject(new GitError({ command, exitCode: code, stdout, stderr }));
      }
    });
  });
}

/** Like {@link exec} but returns raw stdout bytes (e.g. `cat-file` blob content). */
export async function execBuffer(args: string[], opts: ExecOptions): Promise<Buffer> {
  const { path } = await resolveGit();
  const finalArgs = fullArgs(args, opts.raw);
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(path, finalArgs, {
      cwd: opts.cwd,
      shell: false,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => outChunks.push(d));
    child.stderr.on('data', (d: Buffer) => errChunks.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(outChunks));
      } else {
        const command = `git ${finalArgs.join(' ')}`;
        reject(new GitError({ command, exitCode: code, stdout: '', stderr: Buffer.concat(errChunks).toString('utf8') }));
      }
    });
  });
}

/**
 * Stream stdout split on `separator`, yielding each complete record. Lets the
 * first page of a huge `git log` render before the whole history is read.
 */
export async function* streamRecords(
  args: string[],
  opts: ExecOptions,
  separator: string,
): AsyncGenerator<string> {
  const { path } = await resolveGit();
  const finalArgs = fullArgs(args, opts.raw);
  const child = spawn(path, finalArgs, {
    cwd: opts.cwd,
    shell: false,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
  });

  const cancelSub = opts.token?.onCancellationRequested(() => child.kill());
  const errChunks: Buffer[] = [];
  child.stderr.on('data', (d: Buffer) => errChunks.push(d));

  let buffer = '';
  child.stdout.setEncoding('utf8');

  try {
    const queue: string[] = [];
    let resolveNext: (() => void) | undefined;
    let done = false;
    let error: unknown;

    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf(separator)) !== -1) {
        queue.push(buffer.slice(0, idx));
        buffer = buffer.slice(idx + separator.length);
      }
      resolveNext?.();
    });
    child.on('error', (err) => {
      error = err;
      done = true;
      resolveNext?.();
    });
    child.on('close', (code) => {
      if (buffer.length > 0) queue.push(buffer);
      buffer = '';
      if (code !== 0 && !opts.token?.isCancellationRequested) {
        error = new GitError({
          command: `git ${finalArgs.join(' ')}`,
          exitCode: code,
          stdout: '',
          stderr: Buffer.concat(errChunks).toString('utf8'),
        });
      }
      done = true;
      resolveNext?.();
    });

    while (true) {
      if (queue.length > 0) {
        yield queue.shift() as string;
        continue;
      }
      if (error) throw error;
      if (done) return;
      await new Promise<void>((r) => (resolveNext = r));
    }
  } finally {
    cancelSub?.dispose();
    if (!child.killed) child.kill();
  }
}
