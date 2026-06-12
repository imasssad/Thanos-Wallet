/**
 * In-app dApp browser — desktop-only.
 *
 * Mounts a `WebContentsView` over the main BrowserWindow, leaving room
 * at the top for the renderer's browser chrome (back/forward/reload + URL +
 * close). The renderer drives the lifecycle via IPC; this module owns the
 * single WebContentsView instance and surfaces navigation events back over
 * `dapp:event` so the URL bar / title can update in sync.
 *
 * Why WebContentsView (not <webview>): WebContentsView lives in the main
 * process, so we can hard-restrict permissions (no HID / camera / mic),
 * intercept new-window requests, and isolate from the wallet renderer.
 * The renderer never gets a reference to the dApp's window object.
 *
 * Why not BrowserView: BrowserView is deprecated as of Electron 30.
 *
 * Security stance:
 *   - contextIsolation:true, nodeIntegration:false, sandbox:true
 *   - No preload script means dApps see no `window.thanosDesktop` —
 *     wallet connection must go through WalletConnect.
 *   - Permission requests blanket-denied.
 *   - new-window opens the user's default browser, not a child view.
 *   - HTTP-only URLs are upgraded to https on navigate to defeat
 *     transparent downgrades.
 */
const { WebContentsView, shell, BrowserWindow, ipcMain } = require('electron') as typeof import('electron');

interface ViewBounds { x: number; y: number; width: number; height: number }

interface DappOpenPayload {
  url: string;
  bounds: ViewBounds;
}

let view: import('electron').WebContentsView | null = null;
let host: import('electron').BrowserWindow | null = null;
let currentUrl = '';

/** Send a navigation/title event back to the renderer chrome. */
function emit(kind: string, data: Record<string, unknown> = {}): void {
  host?.webContents.send('dapp:event', { kind, ...data });
}

function ensureHttps(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (u.protocol === 'http:') u.protocol = 'https:';
    if (u.protocol !== 'https:') throw new Error('non_https');
    return u.toString();
  } catch {
    throw new Error('invalid_url');
  }
}

function destroy(): void {
  if (!view || !host) return;
  try { host.contentView.removeChildView(view); } catch { /* already removed */ }
  // WebContentsView in Electron 33 doesn't have an explicit destroy() —
  // dropping the reference lets GC reap it once webContents is closed.
  try { view.webContents.close(); } catch { /* already closed */ }
  view = null;
  currentUrl = '';
}

function createView(): import('electron').WebContentsView {
  const v = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          true,
      // ISOLATED session partition — without this the view shares the
      // DEFAULT session, and the blanket permission-deny below would
      // overwrite the wallet window's Ledger/Trezor HID allow-handlers
      // (one handler per session, last writer wins): opening any dApp
      // silently broke hardware wallets until restart. 'persist:' keeps
      // dApp logins across app restarts while staying fully separate
      // from the wallet's session (cookies, storage, permissions).
      partition: 'persist:dapp-browser',
      // No preload — dApps get no privileged bridge. Wallet connection
      // happens via WalletConnect QR, just like any external browser.
    },
  });

  const wc = v.webContents;

  // Blanket-deny camera / mic / hid / usb / geolocation / clipboard etc.
  // Scoped to the dApp partition only — the wallet window's session
  // keeps its own hardware-wallet handlers untouched.
  wc.session.setPermissionRequestHandler((_w, _perm, cb) => cb(false));
  wc.session.setDevicePermissionHandler(() => false);

  // Cross-window navigation (target=_blank, window.open) goes to the
  // user's default browser, not a child WebContentsView. Keeps the
  // in-app browser to one URL at a time.
  wc.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:' || u.protocol === 'http:') {
        void shell.openExternal(url);
      }
    } catch { /* malformed — drop */ }
    return { action: 'deny' };
  });

  // Bubble lifecycle events back to renderer so the chrome stays in
  // sync with the actual page state.
  wc.on('did-start-loading',  ()              => emit('loading-start'));
  wc.on('did-stop-loading',   ()              => emit('loading-stop'));
  wc.on('did-navigate',       (_e, url)       => { currentUrl = url; emit('did-navigate',         { url, canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward() }); });
  wc.on('did-navigate-in-page',(_e, url)      => { currentUrl = url; emit('did-navigate-in-page', { url, canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward() }); });
  wc.on('page-title-updated', (_e, title)     => emit('title', { title }));
  wc.on('did-fail-load',      (_e, code, desc, url) => {
    // Ignore aborts from new navigations (-3) and sub-resource fails —
    // only show errors on top-level load failures.
    if (code === -3) return;
    emit('load-fail', { code, description: desc, url });
  });

  return v;
}

function attachIpc(): void {
  ipcMain.handle('dapp:open', async (_e, payload: DappOpenPayload) => {
    if (!host) return { ok: false, error: 'no_host' };
    const url = ensureHttps(payload.url);
    if (!view) {
      view = createView();
      host.contentView.addChildView(view);
    }
    view.setBounds({
      x:      Math.round(payload.bounds.x),
      y:      Math.round(payload.bounds.y),
      width:  Math.round(payload.bounds.width),
      height: Math.round(payload.bounds.height),
    });
    await view.webContents.loadURL(url);
    currentUrl = url;
    return { ok: true, url };
  });

  ipcMain.handle('dapp:close', () => {
    destroy();
    return { ok: true };
  });

  ipcMain.handle('dapp:set-bounds', (_e, bounds: ViewBounds) => {
    if (!view) return { ok: false };
    view.setBounds({
      x:      Math.round(bounds.x),
      y:      Math.round(bounds.y),
      width:  Math.round(bounds.width),
      height: Math.round(bounds.height),
    });
    return { ok: true };
  });

  ipcMain.handle('dapp:back', () => {
    if (!view) return { ok: false };
    const h = view.webContents.navigationHistory;
    if (h.canGoBack()) h.goBack();
    return { ok: true };
  });

  ipcMain.handle('dapp:forward', () => {
    if (!view) return { ok: false };
    const h = view.webContents.navigationHistory;
    if (h.canGoForward()) h.goForward();
    return { ok: true };
  });

  ipcMain.handle('dapp:reload', () => {
    if (!view) return { ok: false };
    view.webContents.reload();
    return { ok: true };
  });

  ipcMain.handle('dapp:navigate', async (_e, rawUrl: string) => {
    if (!view) return { ok: false };
    const url = ensureHttps(rawUrl);
    await view.webContents.loadURL(url);
    return { ok: true, url };
  });

  ipcMain.handle('dapp:current', () => ({
    open: !!view,
    url:  currentUrl,
    canGoBack:    view?.webContents.navigationHistory.canGoBack()    ?? false,
    canGoForward: view?.webContents.navigationHistory.canGoForward() ?? false,
  }));
}

/** Wire the in-app browser to a host BrowserWindow. Idempotent. */
export function installDappBrowser(win: import('electron').BrowserWindow): void {
  host = win;
  attachIpc();
  // Tear down the view if the main window goes away, otherwise its
  // webContents leaks past quit and electron-builder dumps a warning.
  win.on('closed', () => { destroy(); host = null; });
}
