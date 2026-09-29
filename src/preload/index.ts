// The only bridge between the page and the machine: a single `call` + events.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('livingRepo', {
  platform: process.platform,
  call: (method: string, args: unknown[]) => ipcRenderer.invoke('api', method, args),
  onEvent: (fn: (e: unknown) => void) => {
    const handler = (_: unknown, e: unknown) => fn(e);
    ipcRenderer.on('backend-event', handler);
    return () => ipcRenderer.removeListener('backend-event', handler);
  },
  // Version and automatic updates.
  appInfo: () => ipcRenderer.invoke('app:info'),
  checkUpdates: () => ipcRenderer.invoke('app:check-updates'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  onUpdate: (fn: (s: unknown) => void) => {
    const handler = (_: unknown, s: unknown) => fn(s);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },
});
