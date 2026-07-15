import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function initLogger(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('GitRaven');
  }
  return channel;
}

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

export const log = {
  info(message: string): void {
    channel?.appendLine(`[${ts()}] ${message}`);
  },
  warn(message: string): void {
    channel?.appendLine(`[${ts()}] WARN  ${message}`);
  },
  error(message: string, err?: unknown): void {
    const detail = err instanceof Error ? `\n${err.stack ?? err.message}` : err ? `\n${String(err)}` : '';
    channel?.appendLine(`[${ts()}] ERROR ${message}${detail}`);
  },
};
