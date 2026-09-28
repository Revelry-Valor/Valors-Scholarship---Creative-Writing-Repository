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
});
