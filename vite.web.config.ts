// Single-file browser demo build: the whole app, engine included, in one HTML page.
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

const shim = (f: string) => resolve('src/web/shims', f);

export default defineConfig({
  root: 'src/web',
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      'node:fs': shim('fs.ts'),
      'node:path': shim('path.ts'),
      'node:os': shim('os.ts'),
      chokidar: shim('chokidar.ts'),
      mammoth: resolve('node_modules/mammoth/mammoth.browser.js'),
    },
  },
  define: { 'process.env': '{}', 'process.platform': '"web"' },
  build: { outDir: resolve('dist-web'), emptyOutDir: true },
});
