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
const { WebContentsView, shell, BrowserWindow, ipcMain, dialog } = require('electron') as typeof import('electron');
const path = require('path') as typeof import('path');
const { JsonRpcProvider } = require('ethers') as typeof import('ethers');

interface ViewBounds { x: number; y: number; width: number; height: number }

interface DappOpenPayload {
  url: string;
  bounds: ViewBounds;
}

let view: import('electron').WebContentsView | null = null;
let host: import('electron').BrowserWindow | null = null;
let currentUrl = '';

const CHAIN_HEX = '0xab169'; // Makalu 700777

// Per-open connection state — reset when the browser view is destroyed.
// connectedOrigin scopes the grant to the host that was approved: navigating
// the same in-app browser to a DIFFERENT site must not inherit the address
// (each origin re-approves), so every check below compares it to the request's
// current origin.
let connected = false;
let connectedAddress = '';
let connectedOrigin = '';

// Post-approval signing round-trips to the wallet renderer are correlated by
// id (main owns the approval dialog; the renderer owns the seed + signer).
interface PendingExec { resolve: (v: { result?: unknown; error?: { code: number; message: string } }) => void }
const pendingExec = new Map<number, PendingExec>();
let execSeq = 0;

function rejectAllExec(): void {
  for (const [, p] of pendingExec) p.resolve({ error: { code: 4900, message: 'Wallet disconnected' } });
  pendingExec.clear();
}

/** Ask the wallet renderer to sign an already-approved request. Times out so a
 *  renderer that reloads/crashes mid-signing can't hang the dApp's promise
 *  forever (render-process-gone also rejects all pending — see below). */
function execViaRenderer(method: string, params: unknown[]): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  if (!host) return Promise.resolve({ error: { code: 4900, message: 'Wallet disconnected' } });
  const id = ++execSeq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pendingExec.delete(id)) resolve({ error: { code: -32603, message: 'Signing timed out' } });
    }, 120_000);
    pendingExec.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); } });
    host!.webContents.send('dapp:exec', { id, method, params });
  });
}

// Read-only JSON-RPC (eth_call, eth_getBalance, …) is answered straight from
// Makalu — no seed, no approval needed.
let readProvider: import('ethers').JsonRpcProvider | null = null;
function makaluRead(): import('ethers').JsonRpcProvider {
  if (!readProvider) readProvider = new JsonRpcProvider('https://rpc.litho.ai', 700777, { staticNetwork: true });
  return readProvider;
}

/** Native approval dialog — the only surface that reliably draws ABOVE the
 *  dApp WebContentsView. Returns true if the user approved. */
async function approveViaDialog(kind: 'connect' | 'sign' | 'tx', originHost: string, detail: string): Promise<boolean> {
  if (!host) return false;
  const site = originHost || 'this site';
  const confirmLabel = kind === 'connect' ? 'Connect' : kind === 'tx' ? 'Approve & Send' : 'Sign';
  const message =
    kind === 'connect' ? `Connect to ${site}?`
    : kind === 'tx'    ? `Approve transaction from ${site}?`
    :                    `Signature request from ${site}`;
  const { response } = await dialog.showMessageBox(host, {
    type: 'question',
    buttons: ['Cancel', confirmLabel],
    // Default to Cancel: a stray Enter must never approve a signature or tx.
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Thanos Wallet',
    message,
    detail,
  });
  return response === 1;
}

/** Human-readable detail for the approval dialog. */
function describeForApproval(method: string, params: unknown[]): string {
  try {
    if (method === 'personal_sign' || method === 'eth_sign') {
      const raw = method === 'personal_sign' ? params[0] : params[1];
      let text = typeof raw === 'string' ? raw : '';
      if (/^0x[0-9a-fA-F]*$/.test(text)) {
        try { text = Buffer.from(text.slice(2), 'hex').toString('utf8'); } catch { /* keep hex */ }
      }
      return `Message:\n${text.slice(0, 300)}`;
    }
    if (method === 'eth_signTypedData_v4') {
      const typed = JSON.parse(params[1] as string) as { domain?: { name?: string }; primaryType?: string };
      const bits = [typed.domain?.name, typed.primaryType].filter(Boolean).join(' · ');
      return `Typed data (EIP-712)${bits ? `\n${bits}` : ''}`;
    }
    if (method === 'eth_sendTransaction') {
      const tx = (params[0] as { to?: string; value?: string }) ?? {};
      return `To: ${tx.to ?? '—'}${tx.value ? `\nValue (wei): ${tx.value}` : ''}`;
    }
  } catch { /* fall through to the bare method name */ }
  return method;
}

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
  connected = false;
  connectedAddress = '';
  connectedOrigin = '';
  rejectAllExec();
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
      // Provider bridge preload: injects window.ethereum / window.thanos and
      // forwards EIP-1193 requests to main (dapp:rpc), which handles approval
      // (native dialog) + signing (wallet renderer). The seed NEVER enters
      // this sandboxed view — the page can only ask; the user approves each
      // connect/sign explicitly. (WalletConnect QR still works too.)
      preload: path.join(__dirname, 'dapp-provider-preload.js'),
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

  // ─── dApp → wallet RPC bridge ────────────────────────────────────────
  // The dApp view's injected provider (dapp-provider-preload.ts) forwards
  // every EIP-1193 request here. Reads are answered directly; connect / sign /
  // tx go through a native approval dialog, then to the renderer to sign.
  ipcMain.handle('dapp:rpc', async (e, req: { method: string; params?: unknown[] }) => {
    // Only the dApp view may drive this — never the wallet renderer or a
    // stray frame in some other webContents.
    if (!view || e.sender !== view.webContents || !host) {
      return { __thanosError: true, code: 4900, message: 'Wallet disconnected' };
    }
    // Only the TOP frame may drive the wallet. With nodeIntegrationInSubFrames
    // unset the preload doesn't even load in subframes, but don't rely on that
    // — a cross-origin iframe must never reach the signer under the top site's
    // origin. (parent === null ⇔ main frame.)
    if (e.senderFrame && e.senderFrame.parent !== null) {
      return { __thanosError: true, code: 4900, message: 'Wallet disconnected' };
    }
    const method = req.method;
    const params = (req.params ?? []) as unknown[];
    const originHost = (() => { try { return new URL(currentUrl).host; } catch { return ''; } })();

    // Trivially-known / already-authorised reads — no prompt.
    if (method === 'eth_chainId')  return CHAIN_HEX;
    if (method === 'net_version')  return '700777';
    if (method === 'eth_accounts') return connected && connectedAddress && connectedOrigin && connectedOrigin === originHost ? [connectedAddress] : [];
    if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
      const target = ((params[0] as { chainId?: string })?.chainId ?? '').toLowerCase();
      if (target === CHAIN_HEX) return null;
      return { __thanosError: true, code: method === 'wallet_switchEthereumChain' ? 4902 : 4001, message: 'Only Makalu (Lithosphere) is supported in-app.' };
    }

    // Connect — approve, then read the address back from the renderer.
    if (method === 'eth_requestAccounts') {
      // Never grant on an opaque origin (data:/about:blank → host ''), which
      // would otherwise store connectedOrigin '' and wildcard-match later.
      if (!originHost) return { __thanosError: true, code: 4100, message: 'Cannot connect on this page.' };
      if (connected && connectedAddress && connectedOrigin && connectedOrigin === originHost) return [connectedAddress];
      const ok = await approveViaDialog('connect', originHost,
        `${originHost || 'This site'} will see your wallet address and can request signatures. Each signature still needs your approval.`);
      if (!ok) return { __thanosError: true, code: 4001, message: 'User rejected the connection request.' };
      const out = await execViaRenderer('eth_requestAccounts', params);
      if (out.error) return { __thanosError: true, code: out.error.code, message: out.error.message };
      const accts = out.result as string[];
      if (Array.isArray(accts) && accts.length) {
        connected = true;
        connectedAddress = accts[0];
        connectedOrigin = originHost;
        view.webContents.send('dapp:emit', { event: 'accountsChanged', data: accts });
      }
      return out.result;
    }

    // Signing / transactions — require an active connection to THIS origin
    // first (matches the account paths + the file invariant: enforces
    // connect-before-sign and can't attribute a signature to a site the user
    // never connected to). Then approve, then sign in the renderer.
    if (method === 'personal_sign' || method === 'eth_sign' || method === 'eth_signTypedData_v4' || method === 'eth_sendTransaction') {
      if (!connected || !connectedOrigin || connectedOrigin !== originHost) {
        return { __thanosError: true, code: 4100, message: 'Unauthorized — connect the wallet to this site first.' };
      }
      const kind = method === 'eth_sendTransaction' ? 'tx' : 'sign';
      const ok = await approveViaDialog(kind, originHost, describeForApproval(method, params));
      if (!ok) return { __thanosError: true, code: 4001, message: 'User rejected the request.' };
      const out = await execViaRenderer(method, params);
      if (out.error) return { __thanosError: true, code: out.error.code, message: out.error.message };
      return out.result;
    }

    // Anything else is a read — proxy to Makalu.
    try {
      return await makaluRead().send(method, params);
    } catch (err) {
      return { __thanosError: true, code: -32603, message: (err as Error)?.message || 'RPC error' };
    }
  });

  // The renderer's verdict for an approved signing request (DappRequestHost)
  // resolves the matching execViaRenderer promise.
  ipcMain.on('dapp:exec-response', (e, res: { id: number; result?: unknown; error?: { code: number; message: string } }) => {
    if (!host || e.sender !== host.webContents) return;
    const p = pendingExec.get(res.id);
    if (!p) return;
    pendingExec.delete(res.id);
    p.resolve({ result: res.result, error: res.error });
  });
}

/** Wire the in-app browser to a host BrowserWindow. Idempotent. */
export function installDappBrowser(win: import('electron').BrowserWindow): void {
  host = win;
  attachIpc();
  // If the wallet renderer dies mid-signing, resolve any in-flight exec
  // promises with an error instead of leaving the dApp hanging (the 120s
  // per-request timeout is the backstop; this is the prompt path).
  win.webContents.on('render-process-gone', () => rejectAllExec());
  // Tear down the view if the main window goes away, otherwise its
  // webContents leaks past quit and electron-builder dumps a warning.
  win.on('closed', () => { destroy(); host = null; });
}
