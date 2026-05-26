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

/** Minimal shape of an ethers TransactionRequest serialised to JSON for
 *  IPC. The main-process signer (`src/main/signer.ts`) normalises numeric
 *  fields. We accept hex or decimal strings — no bigints crossing IPC. */
export interface TxRequest {
  to?: string; value?: string; data?: string;
  gas?: string; gasPrice?: string;
  maxFeePerGas?: string; maxPriorityFeePerGas?: string;
  nonce?: number;
}

export interface TypedDataPayload {
  domain: Record<string, unknown>;
  types:  Record<string, Array<{ name: string; type: string }>>;
  value:  Record<string, unknown>;
}

contextBridge.exposeInMainWorld('thanosDesktop', {
  vaultGet:    (key: string) => ipcRenderer.invoke('vault:get', key),
  vaultSet:    (key: string, value: string) => ipcRenderer.invoke('vault:set', key, value),
  vaultRemove: (key: string) => ipcRenderer.invoke('vault:remove', key),

  /** Open an http(s) URL in the user's default browser. */
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  /* ─── Isolated signer ────────────────────────────────────────────────
     The seed travels into the main process exactly once at unlock; from
     then on the renderer only knows the *address* derived from each HD
     path, never the private key. */
  signer: {
    setSeed:    (seed: string)            => ipcRenderer.invoke('signer:set-seed', seed)    as Promise<void>,
    clearSeed:  ()                        => ipcRenderer.invoke('signer:clear-seed')        as Promise<void>,
    hasSeed:    ()                        => ipcRenderer.invoke('signer:has-seed')          as Promise<boolean>,
    address:    (hdPath: string)          => ipcRenderer.invoke('signer:address', hdPath)   as Promise<string>,
    sendTx:     (hdPath: string, tx: TxRequest) => ipcRenderer.invoke('signer:send-tx', hdPath, tx)     as Promise<string>,
    signTx:     (hdPath: string, tx: TxRequest) => ipcRenderer.invoke('signer:sign-tx', hdPath, tx)     as Promise<string>,
    personal:   (hdPath: string, msg: string | Uint8Array) => ipcRenderer.invoke('signer:personal', hdPath, msg) as Promise<string>,
    typedData:  (hdPath: string, payload: TypedDataPayload) => ipcRenderer.invoke('signer:typed-data', hdPath, payload) as Promise<string>,
    erc20Transfer: (hdPath: string, args: { tokenAddress: string; to: string; amount: string }) =>
      ipcRenderer.invoke('signer:erc20-transfer', hdPath, args) as Promise<string>,
  },

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
