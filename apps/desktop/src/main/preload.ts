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

  /** Write text to the OS clipboard via Electron's clipboard module.
   *  navigator.clipboard is blocked in the packaged file:// renderer
   *  (non-secure context), so every Copy button silently failed. */
  clipboardWrite: (text: string) => ipcRenderer.invoke('clipboard:write', text) as Promise<{ ok: boolean }>,

  /** Show an OS notification for wallet activity (WC requests, tx confirm/fail,
   *  bridge/swap). Notification lives in the main process. */
  notify: (title: string, body: string) => ipcRenderer.invoke('notify:show', title, body) as Promise<{ ok: boolean }>,

  /* ─── In-app dApp browser ────────────────────────────────────────────
     Mounts a sandboxed WebContentsView over the renderer area. The
     renderer draws the chrome (back / forward / reload / URL / close)
     and tells the main process where the BrowserView should sit via
     `setBounds`. Navigation events stream back via onDappEvent. */
  dapp: {
    open:      (url: string, bounds: { x: number; y: number; width: number; height: number }) =>
                 ipcRenderer.invoke('dapp:open', { url, bounds }) as Promise<{ ok: boolean; url?: string; error?: string }>,
    close:     () => ipcRenderer.invoke('dapp:close')             as Promise<{ ok: boolean }>,
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
                 ipcRenderer.invoke('dapp:set-bounds', bounds)    as Promise<{ ok: boolean }>,
    back:      () => ipcRenderer.invoke('dapp:back')              as Promise<{ ok: boolean }>,
    forward:   () => ipcRenderer.invoke('dapp:forward')           as Promise<{ ok: boolean }>,
    reload:    () => ipcRenderer.invoke('dapp:reload')            as Promise<{ ok: boolean }>,
    navigate:  (url: string) => ipcRenderer.invoke('dapp:navigate', url) as Promise<{ ok: boolean; url?: string }>,
    current:   () => ipcRenderer.invoke('dapp:current') as Promise<{ open: boolean; url: string; canGoBack: boolean; canGoForward: boolean }>,
    onEvent:   (cb: (ev: { kind: string; url?: string; title?: string; canGoBack?: boolean; canGoForward?: boolean; code?: number; description?: string }) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, ev: { kind: string; [k: string]: unknown }) => cb(ev as Parameters<typeof cb>[0]);
      ipcRenderer.on('dapp:event', handler);
      return () => ipcRenderer.off('dapp:event', handler);
    },

    /* Post-approval signing bridge for the in-app browser's injected
       provider. Main owns the approval dialog (the only surface that draws
       above the WebContentsView); once approved, main asks the renderer to
       sign here — the renderer holds the seed + active account and reuses the
       WalletConnect signer. See dapp-browser.ts + DappRequestHost.tsx. */
    onExec: (cb: (req: { id: number; method: string; params: unknown[]; chainId?: number }) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, req: { id: number; method: string; params: unknown[]; chainId?: number }) => cb(req);
      ipcRenderer.on('dapp:exec', handler);
      return () => ipcRenderer.off('dapp:exec', handler);
    },
    execRespond: (id: number, result: unknown, error?: { code: number; message: string }) =>
      ipcRenderer.send('dapp:exec-response', { id, result, error }),
  },

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

  /* ─── Native-HID Ledger fallback ────────────────────────────────────
     Renderer's primary Ledger path is WebHID (works on macOS + Windows).
     On Linux (or any env where WebHID is unavailable), the renderer
     can call into this bridge instead — the transport lives in the
     main process so node-hid is reachable.

     `available()` is a cheap probe — returns false if the optional
     `@ledgerhq/hw-transport-node-hid-noevents` dep isn't installed. The
     renderer uses it to decide whether to advertise the fallback path
     in the UI. */
  ledgerNative: {
    available:  ()                                                 => ipcRenderer.invoke('ledger-native:available')           as Promise<boolean>,
    getAddress: (hdPath?: string)                                  => ipcRenderer.invoke('ledger-native:get-address', hdPath) as Promise<string>,
    signEvmTx:  (hdPath: string, unsignedHex: string)              => ipcRenderer.invoke('ledger-native:sign-evm-tx', hdPath, unsignedHex) as Promise<{ v: string; r: string; s: string }>,
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
