// One client for both hosts: Electron (preload bridge) or the browser dev server.
import type { BackendEvent, BackendMethods } from '../../backend/backend';

type Bridge = {
  platform: string;
  call(method: string, args: unknown[]): Promise<{ ok: boolean; value?: unknown; error?: string }>;
  onEvent(fn: (e: BackendEvent) => void): () => void;
};

declare global {
  interface Window {
    livingRepo?: Bridge;
    /** The browser demo runs the backend inside the page. */
    __lrBackend?: Omit<Bridge, 'platform'> & { ready: Promise<void>; reset(): void };
  }
}

const bridge = (): Pick<Bridge, 'call' | 'onEvent'> | undefined => window.livingRepo ?? window.__lrBackend;

async function httpCall(method: string, args: unknown[]) {
  const res = await fetch(`/api/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  return (await res.json()) as { ok: boolean; value?: unknown; error?: string };
}

type Methods = {
  [K in keyof BackendMethods]: (...args: Parameters<BackendMethods[K]>) => ReturnType<BackendMethods[K]>;
};

export const api = new Proxy({} as Methods, {
  get(_t, method: string) {
    return async (...args: unknown[]) => {
      const b = bridge();
      const r = b ? await b.call(method, args) : await httpCall(method, args);
      if (!r.ok) throw new Error(r.error ?? 'Unknown error');
      return r.value;
    };
  },
});

export function onBackendEvent(fn: (e: BackendEvent) => void): () => void {
  const b = bridge();
  if (b) return b.onEvent(fn);
  const es = new EventSource('/api/events');
  es.onmessage = (m) => fn(JSON.parse(m.data));
  return () => es.close();
}

export type Awaited2<T> = T extends Promise<infer U> ? U : T;
export type ApiResult<K extends keyof BackendMethods> = Awaited2<ReturnType<BackendMethods[K]>>;
