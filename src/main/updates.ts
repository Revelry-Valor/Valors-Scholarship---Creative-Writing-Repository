// Automatic updates (spec 19.1): the installed app checks GitHub Releases, downloads a
// newer version in the background and installs it on restart. Your projects are
// ordinary folders on disk and are never touched by an update.
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import electronUpdater from 'electron-updater';

export type UpdateStatus =
  | { state: 'idle' | 'checking' | 'none' | 'dev' }
  | { state: 'downloading'; version?: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

let status: UpdateStatus = { state: 'idle' };

export function setupUpdates(getWin: () => BrowserWindow | null) {
  const send = (s: UpdateStatus) => {
    status = s;
    getWin()?.webContents.send('update-status', s);
  };
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), packaged: app.isPackaged, status }));

  // Running from source (npm run dev): there is nothing to update.
  if (!app.isPackaged) {
    status = { state: 'dev' };
    ipcMain.handle('app:check-updates', () => status);
    return;
  }

  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Versions like 0.3.0-beta.1 are offered too, since this is a beta programme.
  autoUpdater.allowPrerelease = true;

  let version: string | undefined;
  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => send({ state: 'none' }));
  autoUpdater.on('update-available', (info) => {
    version = info.version;
    send({ state: 'downloading', version, percent: 0 });
  });
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', version, percent: Math.round(p.percent) }));
  autoUpdater.on('error', (err) => send({ state: 'error', message: err?.message ?? String(err) }));
  autoUpdater.on('update-downloaded', async (info) => {
    send({ state: 'ready', version: info.version });
    const win = getWin();
    const opts = {
      type: 'info' as const,
      title: 'Update ready',
      message: `Living Repository ${info.version} is ready to install.`,
      detail: 'Restart now to use it, or it will be installed the next time you close the app. Your projects are not affected.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    };
    const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    if (r.response === 0) autoUpdater.quitAndInstall();
  });

  const check = () => autoUpdater.checkForUpdates().catch((err) => send({ state: 'error', message: err?.message ?? String(err) }));
  ipcMain.handle('app:check-updates', async () => {
    if (status.state !== 'downloading' && status.state !== 'ready') await check();
    return status;
  });
  ipcMain.handle('app:install-update', () => autoUpdater.quitAndInstall());
  setTimeout(check, 8000);
  setInterval(check, 4 * 60 * 60 * 1000);
}
