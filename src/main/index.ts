// Electron main process: one window, the backend behind IPC.
import { app, BrowserWindow, dialog, ipcMain, shell, Menu, session, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Backend } from '../backend/backend';
import { setupUpdates } from './updates';

const here = path.dirname(fileURLToPath(import.meta.url));
let win: BrowserWindow | null = null;

const backend = new Backend(app.getPath('userData'), {
  pickFolder: async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  },
  revealPath: (p) => shell.showItemInFolder(p),
  // Names of people, places and topics are never marked as misspelled.
  onVaultOpened: (words) => {
    for (const w of words) session.defaultSession.addWordToSpellCheckerDictionary(w);
  },
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
      spellcheck: true,
    },
  });
  // Right-click: spelling suggestions, add to dictionary, and the usual edit commands.
  win.webContents.on('context-menu', (_e, params) => {
    const items: MenuItemConstructorOptions[] = [];
    if (params.misspelledWord) {
      for (const s of params.dictionarySuggestions.slice(0, 6)) items.push({ label: s, click: () => win?.webContents.replaceMisspelling(s) });
      if (!params.dictionarySuggestions.length) items.push({ label: 'No suggestions', enabled: false });
      items.push({ label: `Add “${params.misspelledWord}” to dictionary`, click: () => session.defaultSession.addWordToSpellCheckerDictionary(params.misspelledWord) });
      items.push({ type: 'separator' });
    }
    if (params.isEditable || params.selectionText) {
      items.push({ role: 'cut', enabled: params.editFlags.canCut }, { role: 'copy', enabled: params.editFlags.canCopy }, { role: 'paste', enabled: params.editFlags.canPaste }, { type: 'separator' }, { role: 'selectAll' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win! });
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
  setupUpdates(() => win);
  await createWindow();
});

app.on('window-all-closed', async () => {
  await backend.closeVault();
  app.quit();
});
