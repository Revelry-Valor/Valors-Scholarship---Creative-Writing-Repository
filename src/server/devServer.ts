// Browser mode: serves the same UI and backend over HTTP for development,
// automated UI tests and screenshots. Not used by the desktop app.
//   npm run web            → http://localhost:5199
//   LR_CONFIG_DIR=... npm run web   to use a separate config (recent vaults, author)
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createServer as createVite } from 'vite';
import react from '@vitejs/plugin-react';
import { Backend, type BackendEvent } from '../backend/backend';

const port = Number(process.env.PORT ?? 5199);
const configDir = process.env.LR_CONFIG_DIR ?? path.join(os.homedir(), '.living-repository-web');

const backend = new Backend(configDir);
await backend.init();
if (process.env.LR_VAULT) await backend.methods.openVault(process.env.LR_VAULT);
else await backend.restoreLastVault();

const clients = new Set<http.ServerResponse>();
backend.onEvent((e: BackendEvent) => {
  for (const res of clients) res.write(`data: ${JSON.stringify(e)}\n\n`);
});

const vite = await createVite({
  root: path.resolve('src/renderer'),
  plugins: [react()],
  server: { middlewareMode: true },
  appType: 'spa',
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': hi\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname.startsWith('/api/') && req.method === 'POST') {
    const method = url.pathname.slice(5);
    let body = '';
    for await (const chunk of req) body += chunk;
    let payload: { ok: boolean; value?: unknown; error?: string };
    try {
      payload = { ok: true, value: await backend.call(method, JSON.parse(body || '[]')) };
    } catch (err) {
      payload = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload ?? null));
    return;
  }
  vite.middlewares(req, res);
});

server.listen(port, () => console.log(`Living Repository (browser mode) on http://localhost:${port}`));
