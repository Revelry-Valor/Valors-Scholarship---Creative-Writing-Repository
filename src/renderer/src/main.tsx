import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, onBackendEvent, type ApiResult } from './api';
import { AppProvider } from './state';
import { DialogProvider } from './components/Dialogs';
import { StartScreen } from './components/StartScreen';
import { Workspace } from './components/Workspace';
import { applyTheme } from './theme';
import './styles.css';

type VaultInfo = NonNullable<ApiResult<'appState'>['vault']>;

function App() {
  const [vault, setVault] = useState<VaultInfo | null | undefined>(undefined);
  const refresh = () => api.appState().then((s) => setVault(s.vault));
  useEffect(() => {
    refresh();
    return onBackendEvent((e) => {
      if (e.type === 'vault-opened' || e.type === 'vault-closed') refresh();
    });
  }, []);
  if (vault === undefined) return <div className="boot">Loading…</div>;
  if (!vault) return <StartScreen onOpened={refresh} />;
  // Dialogs render inside the app state so their content can show chips and blocks.
  return (
    <AppProvider key={vault.root} info={vault}>
      <DialogProvider>
        <Workspace
          onCloseVault={async () => {
            await api.closeVault();
            setVault(null);
          }}
        />
      </DialogProvider>
    </AppProvider>
  );
}

applyTheme();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
