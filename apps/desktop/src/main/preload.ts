import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

/** Mirrors UpdateEvent in src/main/updater.ts. Renderers should treat
 *  unknown `kind` values as forward-compat — render nothing rather than
 *  throw. */
export type UpdaterEvent =
  | { kind: 'checking' }
  | { kind: 'available';   version: string; releaseNotes?: string | null }
  | { kind: 'not-available' }
  | { kind: 'progress';    percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { kind: 'downloaded';  version: string; releaseNotes?: string | null }
  | { kind: 'error';       message: string };

contextBridge.exposeInMainWorld('thanosDesktop', {
  vaultGet:    (key: string) => ipcRenderer.invoke('vault:get', key),
  vaultSet:    (key: string, value: string) => ipcRenderer.invoke('vault:set', key, value),
  vaultRemove: (key: string) => ipcRenderer.invoke('vault:remove', key),

  /** Open an http(s) URL in the user's default browser. */
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  /* electron-updater bridge.
     onUpdateEvent returns a teardown function so React useEffects can
     subscribe + clean up without leaking listeners. */
  onUpdateEvent: (cb: (ev: UpdaterEvent) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, ev: UpdaterEvent) => cb(ev);
    ipcRenderer.on('updater:event', handler);
    return () => ipcRenderer.off('updater:event', handler);
  },
  /** Manually trigger a check (e.g. from a "Check for updates" Settings button). */
  checkForUpdate:    () => ipcRenderer.invoke('updater:check'),
  /** Install the downloaded update and restart. The app will exit immediately. */
  installAndRestart: () => ipcRenderer.invoke('updater:install'),
});
