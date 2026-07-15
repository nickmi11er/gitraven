import type { GitErrorDTO } from '../../shared/model';

export type GitErrorKind = GitErrorDTO['kind'];

export class GitError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout: string;
  readonly command: string;
  readonly kind: GitErrorKind;

  constructor(params: {
    command: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }) {
    const kind = classify(params.stderr, params.exitCode);
    super(firstLine(params.stderr) || `git exited with code ${params.exitCode}`);
    this.name = 'GitError';
    this.command = params.command;
    this.exitCode = params.exitCode;
    this.stdout = params.stdout;
    this.stderr = params.stderr;
    this.kind = kind;
  }

  toDTO(): GitErrorDTO {
    return {
      message: this.message,
      exitCode: this.exitCode,
      stderr: this.stderr,
      command: this.command,
      kind: this.kind,
    };
  }
}

function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
}

function classify(stderr: string, exitCode: number | null): GitErrorKind {
  const s = stderr.toLowerCase();
  if (s.includes('not a git repository')) return 'not-a-repo';
  if (s.includes('index.lock') || s.includes('unable to create') && s.includes('.lock')) return 'locked';
  if (
    s.includes('could not read from remote') ||
    s.includes('authentication failed') ||
    s.includes('permission denied') ||
    s.includes('terminal prompts disabled')
  ) {
    return 'auth';
  }
  if (
    s.includes('conflict') ||
    s.includes('needs merge') ||
    s.includes('overwritten by') ||
    s.includes('fix conflicts')
  ) {
    return 'conflict';
  }
  void exitCode;
  return 'unknown';
}

export function toGitErrorDTO(err: unknown): GitErrorDTO {
  if (err instanceof GitError) return err.toDTO();
  return {
    message: err instanceof Error ? err.message : String(err),
    exitCode: null,
    stderr: '',
    command: '',
    kind: 'unknown',
  };
}
