import type { Event, InboundMessage, OutboundMessage, Request } from '../shared/protocol';
import type { GitErrorDTO } from '../shared/model';

interface VsCodeApi {
  postMessage(msg: InboundMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: GitErrorDTO) => void }>();
const eventHandlers = new Set<(ev: Event) => void>();

window.addEventListener('message', (e: MessageEvent<OutboundMessage>) => {
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'response') {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.data);
    else p.reject(msg.error);
  } else if (msg.type === 'event') {
    const { type: _t, ...ev } = msg;
    for (const h of eventHandlers) h(ev as Event);
  }
});

export function request<T = unknown>(req: Request): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    vscode.postMessage({ type: 'request', id, req });
  });
}

export function onEvent(handler: (ev: Event) => void): () => void {
  eventHandlers.add(handler);
  return () => eventHandlers.delete(handler);
}

/** Persisted webview UI state (survives reloads / hide-show), keyed by field. */
export function getUiState<T>(key: string): T | undefined {
  const state = (vscode.getState() as Record<string, unknown> | undefined) ?? {};
  return state[key] as T | undefined;
}

export function setUiState(key: string, value: unknown): void {
  const state = (vscode.getState() as Record<string, unknown> | undefined) ?? {};
  vscode.setState({ ...state, [key]: value });
}
