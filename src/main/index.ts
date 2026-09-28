// Electron main process: one window, the backend behind IPC.
import { app, BrowserWindow, dialog, ipcMain, shell, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Backend } from '../backend/backend';

const here = path.dirname(fileURLToPath(import.meta.url));
let win: BrowserWindow | null = null;

const backend = new Backend(app.getPath('userData'), {
  pickFolder: async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  },
  revealPath: (p) => shell.showItemInFolder(p),
});

async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: 'Living Repository',
    backgroundColor: '#f6f1e7',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  // Links in writing open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await win.loadFile(path.join(here, '../renderer/index.html'));
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await backend.init();
  await backend.restoreLastVault();
  ipcMain.handle('api', async (_e, method: string, args: unknown[]) => {
    try {
      return { ok: true, value: await backend.call(method, args) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  backend.onEvent((e) => win?.webContents.send('backend-event', e));
  await createWindow();
});

app.on('window-all-closed', async () => {
  await backend.closeVault();
  app.quit();
});
