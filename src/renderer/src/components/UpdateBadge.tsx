// Version and update state in the status bar (desktop app only).
import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../api';
import { useApp } from '../state';

export function UpdateBadge() {
  const app = useApp();
  const bridge = window.livingRepo;
  const [version, setVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  useEffect(() => {
    if (!bridge?.appInfo) return;
    bridge.appInfo().then((i) => {
      setVersion(i.version);
      setStatus(i.status);
    });
    return bridge.onUpdate?.(setStatus);
  }, [bridge]);
  if (!bridge?.appInfo || !version) return null;
  const label =
    status.state === 'downloading'
      ? `Downloading ${status.version ?? 'update'}… ${status.percent}%`
      : status.state === 'ready'
        ? `Restart for ${status.version}`
        : status.state === 'checking'
          ? 'Checking for updates…'
          : `v${version}${status.state === 'dev' ? ' (dev)' : ''}`;
  const click = async () => {
    if (status.state === 'ready') return void bridge.installUpdate?.();
    if (status.state === 'dev') return app.notify('Running from source: updates come from git, not the installer.');
    const s = await bridge.checkUpdates!();
    setStatus(s);
    if (s.state === 'none') app.notify(`You have the latest version (${version}).`);
    if (s.state === 'error') app.notify(`Could not check for updates: ${s.message}`, 'error');
  };
  return (
    <button className={`status-btn update-${status.state}`} onClick={click} title="Living Repository version. Click to check for updates.">
      {label}
    </button>
  );
}
