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
 * process, so we can hard-restrict permissions (no HID / mic; camera only
 * for LAX identity verification, with consent), intercept new-window
 * requests, and isolate from the wallet renderer.
 * The renderer never gets a reference to the dApp's window object.
 *
 * Why not BrowserView: BrowserView is deprecated as of Electron 30.
 *
 * Security stance:
 *   - contextIsolation:true, nodeIntegration:false, sandbox:true
 *   - No preload script means dApps see no `window.thanosDesktop` —
 *     wallet connection must go through WalletConnect.
 *   - Permission requests blanket-denied — except in a LAX identity
 *     verification view, which may use the camera and location once the
 *     user allows it (see "LAX identity verification" below).
 *   - new-window opens the user's default browser, not a child view.
 *   - HTTP-only URLs are upgraded to https on navigate to defeat
 *     transparent downgrades.
 */
const { WebContentsView, shell, BrowserWindow, ipcMain, dialog, session, systemPreferences } = require('electron') as typeof import('electron');
const path = require('path') as typeof import('path');
import { handleTrusted } from './ipc-guard';
import { reviewSigningRequest, type SignReview } from './sign-review';
const { JsonRpcProvider } = require('ethers') as typeof import('ethers');

interface ViewBounds { x: number; y: number; width: number; height: number }

interface DappOpenPayload {
  url: string;
  bounds: ViewBounds;
  /** 'kyc' opens LAX identity verification instead of a dApp — see
   *  "LAX identity verification" below. */
  purpose?: 'kyc';
}

let view: import('electron').WebContentsView | null = null;
let host: import('electron').BrowserWindow | null = null;
let currentUrl = '';
// True while the open view is a LAX identity-verification view.
let kycMode = false;

// Lithosphere Mainnet — where a dApp starts (Makalu isn't built in any more,
// 2026-09-29).
const DEFAULT_CHAIN_ID = 9005;
// Known EVM chains the in-app browser will switch to (chainId → read RPC).
// Mirrors the renderer's EXT_EVM_CHAINS; duplicated here because the main
// process can't import renderer code. NO arbitrary wallet_addEthereumChain —
// known-good RPCs only, so a dApp can't point the wallet at a malicious node.
const BROWSER_CHAINS: Record<number, string> = {
  9005:   'https://rpc-mainnet.litho.ai',   // Lithosphere Mainnet
  1:      'https://ethereum.publicnode.com',
  56:     'https://bsc-dataseed.binance.org',
  137:    'https://polygon-bor-rpc.publicnode.com',
  8453:   'https://mainnet.base.org',
  42161:  'https://arb1.arbitrum.io/rpc',
  59144:  'https://rpc.linea.build',
  10:     'https://mainnet.optimism.io',
  43114:  'https://api.avax.network/ext/bc/C/rpc',
};

// The EVM chain the dApp is currently on — starts on Lithosphere Mainnet; a
// dApp can wallet_switchEthereumChain to any BROWSER_CHAINS member. Reset on
// destroy. Transactions are signed for and broadcast on exactly this chain.
let currentChainId = DEFAULT_CHAIN_ID;

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
function execViaRenderer(method: string, params: unknown[], chainId: number): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  if (!host) return Promise.resolve({ error: { code: 4900, message: 'Wallet disconnected' } });
  const id = ++execSeq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pendingExec.delete(id)) resolve({ error: { code: -32603, message: 'Signing timed out' } });
    }, 120_000);
    pendingExec.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); } });
    // chainId is the chain the renderer signs + broadcasts eth_sendTransaction
    // on — the dApp's current chain, never a default.
    host!.webContents.send('dapp:exec', { id, method, params, chainId });
  });
}

// Read-only JSON-RPC (eth_call, eth_getBalance, …) is answered straight from
// the current chain's RPC — no seed, no approval needed.
const readProviders = new Map<number, import('ethers').JsonRpcProvider>();
function chainRead(chainId: number): import('ethers').JsonRpcProvider {
  let p = readProviders.get(chainId);
  if (!p) {
    const rpc = BROWSER_CHAINS[chainId] ?? BROWSER_CHAINS[DEFAULT_CHAIN_ID];
    p = new JsonRpcProvider(rpc, chainId, { staticNetwork: true });
    readProviders.set(chainId, p);
  }
  return p;
}

/** Native approval dialog — the only surface that reliably draws ABOVE the
 *  dApp WebContentsView. Returns true if the user approved. */
async function approveViaDialog(kind: 'connect' | 'sign' | 'tx', originHost: string, detail: string, highRisk = false): Promise<boolean> {
  if (!host) return false;
  const site = originHost || 'this site';
  const confirmLabel = highRisk ? 'I understand — sign' : kind === 'connect' ? 'Connect' : kind === 'tx' ? 'Approve & Send' : 'Sign';
  const message =
    kind === 'connect' ? `Connect to ${site}?`
    : kind === 'tx'    ? `Approve transaction from ${site}?`
    :                    `Signature request from ${site}`;
  const { response } = await dialog.showMessageBox(host, {
    type: highRisk ? 'warning' : 'question',
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

/** Dialog text for a decoded request (./sign-review): headline, the
 *  decoded rows (spender / token / amount / expiry, "you give / you get"),
 *  then the warnings. */
function describeReview(r: SignReview): string {
  const rows = r.rows.map((x) => `${x.label}: ${x.value}`).join('\n');
  const warnings = r.warnings.map((w) => `⚠ ${w}`).join('\n');
  return [r.title, rows, warnings].filter(Boolean).join('\n\n');
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

/* ─── LAX identity verification ─────────────────────────────────────────
   The one exception to the blanket permission deny. Verification needs the
   camera (ID scan + selfie) and can ask for location, so a view opened with
   purpose 'kyc' gets:
     - its own IN-MEMORY session: nothing the page stores (photos, cookies)
       is written to disk or shared with dApps, and it's wiped on close;
     - no wallet provider preload: the page can't reach the wallet at all;
     - the camera (video only: no microphone, no screen capture) and
       location, each only after the user allows it in a native dialog that
       names the site, remembered for that site until the view closes.
   Every other permission stays denied. */
const KYC_PARTITION = 'lax-kyc';
type KycPermission = 'camera' | 'location';
// `${origin}|${permission}` the user allowed / refused in the open view.
const kycAllowed = new Set<string>();
const kycRefused = new Set<string>();
// One consent dialog at a time.
let kycPrompt: Promise<void> = Promise.resolve();

function httpsOrigin(url: string | undefined): string {
  try { const u = new URL(url ?? ''); return u.protocol === 'https:' ? u.origin : ''; } catch { return ''; }
}

function kycPermissionOf(permission: string, mediaTypes?: ReadonlyArray<string>): KycPermission | null {
  if (permission === 'geolocation') return 'location';
  // A request that includes the microphone is refused as a whole.
  if (permission === 'media') return mediaTypes?.length && mediaTypes.every((t) => t === 'video') ? 'camera' : null;
  return null;
}

async function askKycPermission(kind: KycPermission, origin: string, pageUrl: string): Promise<boolean> {
  if (!host) return false;
  const site = new URL(origin).host;
  const page = (() => { try { return new URL(pageUrl).host; } catch { return ''; } })();
  const { response } = await dialog.showMessageBox(host, {
    type: 'question',
    buttons: ["Don't allow", 'Allow'],
    // Default to refusing: a stray Enter must never turn the camera on.
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Thanos Wallet',
    message: `Allow ${site} to use your ${kind}?`,
    detail: [
      kind === 'camera'
        ? 'LAX identity verification uses the camera to scan your ID and take a selfie.'
        : 'LAX identity verification can check your location as part of the review.',
      page && page !== site ? `Asked from the verification page on ${page}.` : '',
      'Only this verification window gets access, and only until you close it.',
    ].filter(Boolean).join('\n\n'),
  });
  if (response !== 1) return false;
  // macOS asks once more at the system level (System Settings → Privacy).
  if (kind === 'camera' && process.platform === 'darwin') {
    try { return await systemPreferences.askForMediaAccess('camera'); } catch { return false; }
  }
  return true;
}

function installKycPermissions(ses: import('electron').Session): void {
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    let answered = false;
    const reply = (ok: boolean) => { if (!answered) { answered = true; callback(ok); } };
    const kind = kycPermissionOf(permission, 'mediaTypes' in details ? details.mediaTypes : undefined);
    const origin = httpsOrigin(('securityOrigin' in details && details.securityOrigin) || details.requestingUrl);
    const inView = () => !!view && kycMode && wc === view.webContents;
    if (!inView() || !kind || !origin) { reply(false); return; }
    const key = `${origin}|${kind}`;
    if (kycAllowed.has(key)) { reply(true); return; }
    if (kycRefused.has(key)) { reply(false); return; }
    kycPrompt = kycPrompt.then(async () => {
      // Settle again after waiting: the view may have closed, or an earlier
      // prompt already answered for this site.
      if (!inView()) return reply(false);
      if (kycAllowed.has(key)) return reply(true);
      if (kycRefused.has(key)) return reply(false);
      const ok = await askKycPermission(kind, origin, wc.getURL());
      if (!inView()) return reply(false);
      (ok ? kycAllowed : kycRefused).add(key);
      reply(ok);
    }).catch(() => reply(false));
  });
  // Permission checks (navigator.permissions.query): camera / location read
  // as available until refused, so verification SDKs go on to request them —
  // the request handler above is the real gate. Everything else: denied.
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    if (!view || !kycMode || wc !== view.webContents) return false;
    const kind = permission === 'geolocation' ? 'location'
      : permission === 'media' && details.mediaType === 'video' ? 'camera' : null;
    return !!kind && !kycRefused.has(`${httpsOrigin(requestingOrigin)}|${kind}`);
  });
  ses.setDevicePermissionHandler(() => false);
}

function destroy(): void {
  if (!view || !host) return;
  const wasKyc = kycMode;
  try { host.contentView.removeChildView(view); } catch { /* already removed */ }
  // WebContentsView in Electron 33 doesn't have an explicit destroy() —
  // dropping the reference lets GC reap it once webContents is closed.
  try { view.webContents.close(); } catch { /* already closed */ }
  view = null;
  currentUrl = '';
  connected = false;
  connectedAddress = '';
  connectedOrigin = '';
  currentChainId = DEFAULT_CHAIN_ID;
  rejectAllExec();
  kycMode = false;
  kycAllowed.clear();
  kycRefused.clear();
  // Verification data only ever lived in memory; drop it now, not at quit.
  if (wasKyc) {
    const ses = session.fromPartition(KYC_PARTITION);
    void ses.clearStorageData().catch(() => {});
    void ses.clearCache().catch(() => {});
  }
}

function createView(kyc: boolean): import('electron').WebContentsView {
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
      // Identity verification gets its own in-memory session instead.
      partition: kyc ? KYC_PARTITION : 'persist:dapp-browser',
      // Provider bridge preload: injects window.ethereum / window.thanos and
      // forwards EIP-1193 requests to main (dapp:rpc), which handles approval
      // (native dialog) + signing (wallet renderer). The seed NEVER enters
      // this sandboxed view — the page can only ask; the user approves each
      // connect/sign explicitly. (WalletConnect QR still works too.)
      // None for identity verification — that page has no business with
      // the wallet.
      preload: kyc ? undefined : path.join(__dirname, 'dapp-provider-preload.js'),
    },
  });

  const wc = v.webContents;

  // Blanket-deny camera / mic / hid / usb / geolocation / clipboard etc.
  // Scoped to the dApp partition only — the wallet window's session
  // keeps its own hardware-wallet handlers untouched. Identity
  // verification's own session asks the user for camera / location.
  if (kyc) {
    installKycPermissions(wc.session);
  } else {
    wc.session.setPermissionRequestHandler((_w, _perm, cb) => cb(false));
    wc.session.setDevicePermissionHandler(() => false);
  }

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
  handleTrusted('dapp:open', async (_e, payload: DappOpenPayload) => {
    if (!host) return { ok: false, error: 'no_host' };
    const url = ensureHttps(payload.url);
    const kyc = payload.purpose === 'kyc';
    // Verification and dApps never share a view: they run in different
    // sessions under different permission rules.
    if (view && kycMode !== kyc) destroy();
    if (!view) {
      view = createView(kyc);
      kycMode = kyc;
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

  handleTrusted('dapp:close', () => {
    destroy();
    return { ok: true };
  });

  handleTrusted('dapp:set-bounds', (_e, bounds: ViewBounds) => {
    if (!view) return { ok: false };
    view.setBounds({
      x:      Math.round(bounds.x),
      y:      Math.round(bounds.y),
      width:  Math.round(bounds.width),
      height: Math.round(bounds.height),
    });
    return { ok: true };
  });

  handleTrusted('dapp:back', () => {
    if (!view) return { ok: false };
    const h = view.webContents.navigationHistory;
    if (h.canGoBack()) h.goBack();
    return { ok: true };
  });

  handleTrusted('dapp:forward', () => {
    if (!view) return { ok: false };
    const h = view.webContents.navigationHistory;
    if (h.canGoForward()) h.goForward();
    return { ok: true };
  });

  handleTrusted('dapp:reload', () => {
    if (!view) return { ok: false };
    view.webContents.reload();
    return { ok: true };
  });

  handleTrusted('dapp:navigate', async (_e, rawUrl: string) => {
    // The verification view stays on the verification flow.
    if (!view || kycMode) return { ok: false };
    const url = ensureHttps(rawUrl);
    await view.webContents.loadURL(url);
    return { ok: true, url };
  });

  handleTrusted('dapp:current', () => ({
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
    if (!view || kycMode || e.sender !== view.webContents || !host) {
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
    // The origin of the frame that actually sent this request — not the
    // view's last-known URL, which a navigation racing the request could
    // have changed.
    const originHost = (() => { try { return new URL(e.senderFrame?.url || currentUrl).host; } catch { return ''; } })();

    // Trivially-known / already-authorised reads — no prompt.
    if (method === 'eth_chainId')  return `0x${currentChainId.toString(16)}`;
    if (method === 'net_version')  return String(currentChainId);
    if (method === 'eth_accounts') return connected && connectedAddress && connectedOrigin && connectedOrigin === originHost ? [connectedAddress] : [];
    // switch + add behave the same: a KNOWN chain becomes current (and the dApp
    // is told via chainChanged); an unknown one is refused (no arbitrary RPC).
    if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
      const target = Number((params[0] as { chainId?: string })?.chainId ?? NaN);
      if (BROWSER_CHAINS[target]) {
        currentChainId = target;
        view.webContents.send('dapp:emit', { event: 'chainChanged', data: `0x${target.toString(16)}` });
        return null;
      }
      return { __thanosError: true, code: method === 'wallet_switchEthereumChain' ? 4902 : 4001, message: 'Unsupported network — Thanos supports Lithosphere and major EVM chains.' };
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
      const out = await execViaRenderer('eth_requestAccounts', params, currentChainId);
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
      const review = reviewSigningRequest({ method, params, activeChainId: currentChainId, account: connectedAddress });
      if (review.risk === 'block') {
        // Another chain / account, a scam address, a Seaport order that pays
        // nothing, malformed data — explained, never offered for signing.
        await dialog.showMessageBox(host, {
          type: 'warning', buttons: ['OK'], defaultId: 0, noLink: true, title: 'Thanos Wallet',
          message: `The wallet won't sign this request from ${originHost || 'this site'}`,
          detail: describeReview(review),
        });
        return { __thanosError: true, code: 4001, message: review.blockReason ?? 'Request refused by the wallet.' };
      }
      const ok = await approveViaDialog(kind, originHost, describeReview(review), review.risk === 'review');
      if (!ok) return { __thanosError: true, code: 4001, message: 'User rejected the request.' };
      const out = await execViaRenderer(method, params, currentChainId);
      if (out.error) return { __thanosError: true, code: out.error.code, message: out.error.message };
      return out.result;
    }

    // Anything else is a read — proxy to the current chain's RPC.
    try {
      return await chainRead(currentChainId).send(method, params);
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
