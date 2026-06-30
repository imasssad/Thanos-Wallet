// Use require() directly — Electron's module interceptor matches the literal "electron" string
// and TS's __importDefault interop wrapper sometimes breaks this with pnpm symlinks
const { app, BrowserWindow, ipcMain, nativeTheme, shell, session, clipboard } = require('electron') as typeof import('electron');

/* USB / HID vendor IDs we let the renderer enumerate. Hardware-wallet
   manufacturers only — never a blanket "allow all devices" handler. */
const LEDGER_VENDOR_ID  = 0x2c97;
const TREZOR_VENDOR_IDS = [0x534c, 0x1209]; // Trezor One / Trezor T (Trezor Co.)
const HW_VENDOR_IDS     = new Set([LEDGER_VENDOR_ID, ...TREZOR_VENDOR_IDS]);
const path = require('path') as typeof import('path');
import { startAutoUpdater } from './updater';
import * as signer from './signer';
import * as ledgerHid from './ledger-hid-bridge';
import { installDappBrowser } from './dapp-browser';

const SERVICE = 'thanos-wallet';

// keytar is a native module — load lazily so failure doesn't crash startup
let keytar: typeof import('keytar') | null = null;
try { keytar = require('keytar'); } catch (e) { console.warn('keytar unavailable:', e); }

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#080809',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // 1.1 UI scale-up applied at the Chromium level (NOT CSS `zoom`, which
      // desynced click hit-testing so buttons across the app stopped
      // registering). setZoomFactor below re-applies it on every load.
      zoomFactor: 1.1,
    }
  });

  /* Hardware-wallet USB / HID transport — Electron denies device access
     by default. We allow Ledger / Trezor vendor IDs only so the
     renderer's @ledgerhq/hw-transport-webhid + @trezor/connect-web can
     enumerate the device. Other vendors stay denied. */
  const sess = win.webContents.session;

  /* CORS shim for the Lithosphere RPC nodes. Their preflight handling is
     broken upstream: OPTIONS to rpc.litho.ai / rpc-2 is answered by the
     Tendermint index page with no Access-Control-Allow-Origin, and
     Electron renderers enforce CORS exactly like a browser — so every
     ethers JSON-RPC POST (application/json => preflight required) was
     blocked before it left the app. This is why sends failed while
     receives (indexer-fed) worked. Scoped to exactly these hosts; the
     web app solves the same problem with a same-origin Next proxy. */
  const LITHO_RPC_URLS = ['https://rpc.litho.ai/*', 'https://rpc-2.litho.ai/*', 'https://rpc-3.litho.ai/*'];
  sess.webRequest.onHeadersReceived({ urls: LITHO_RPC_URLS }, (details, callback) => {
    const headers: Record<string, string | string[]> = { ...(details.responseHeaders ?? {}) };
    // Drop any existing variants (case differs per server) before injecting.
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase().startsWith('access-control-')) delete headers[k];
    }
    headers['Access-Control-Allow-Origin']  = ['*'];
    headers['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS'];
    headers['Access-Control-Allow-Headers'] = ['Content-Type, Accept, Origin'];
    callback({ responseHeaders: headers });
  });
  sess.setPermissionRequestHandler((_wc, permission, callback) => {
    const p = String(permission);
    callback(p === 'hid' || p === 'usb');
  });
  sess.setDevicePermissionHandler(({ deviceType, device }) => {
    if (deviceType !== 'hid' && deviceType !== 'usb') return false;
    const vid = (device as { vendorId?: number }).vendorId;
    return typeof vid === 'number' && HW_VENDOR_IDS.has(vid);
  });
  sess.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    // Auto-pick the first hardware-wallet device — there's only ever
    // one connected during a signing flow.
    const dev = details.deviceList.find((d) => typeof d.vendorId === 'number' && HW_VENDOR_IDS.has(d.vendorId));
    callback(dev ? dev.deviceId : undefined);
  });

  if (process.env.NODE_ENV === 'development') win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, 'index.html'));

  // Keep the 1.1 UI scale-up at the Chromium level (correct click hit-testing,
  // unlike CSS `zoom`). Re-applied on every load so HMR / navigation can't
  // reset it to 1.0.
  win.webContents.on('did-finish-load', () => { win.webContents.setZoomFactor(1.1); });

  // electron-updater starts polling once the renderer is mounted so the
  // banner UI is ready to receive `updater:event` IPC messages.
  startAutoUpdater(win);

  // In-app dApp browser — wires IPC handlers (`dapp:open`, `dapp:close`,
  // navigation, bounds) and manages a sandboxed WebContentsView over
  // the renderer area. Renderer-side chrome lives in DappBrowserOverlay.
  installDappBrowser(win);
};

app.whenReady().then(() => {
  // Register IPC handlers AFTER app is ready
  ipcMain.handle('vault:get',    (_e, key: string)               => keytar?.getPassword(SERVICE, key)    ?? null);
  ipcMain.handle('vault:set',    (_e, key: string, value: string) => keytar?.setPassword(SERVICE, key, value));
  ipcMain.handle('vault:remove', (_e, key: string)               => keytar?.deletePassword(SERVICE, key));

  // Open external links (Discover ecosystem apps) in the user's default
  // browser. Restricted to http/https so a compromised renderer can't
  // launch arbitrary protocols/handlers.
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:' || u.protocol === 'http:') return shell.openExternal(url);
    } catch { /* malformed URL — ignore */ }
    return Promise.resolve();
  });

  // Clipboard via the main process — navigator.clipboard is blocked in the
  // packaged file:// renderer, so every Copy button needs this bridge.
  ipcMain.handle('clipboard:write', (_e, text: string) => {
    clipboard.writeText(String(text ?? ''));
    return { ok: true };
  });

  /* Main-process signer — keys never leave this process once `set-seed`
     has cached the seed in main memory. The renderer holds an "is
     unlocked" flag only; signing requests round-trip through IPC. */
  ipcMain.handle('signer:set-seed',    (_e, seed: string)            => { signer.setSeed(seed); });
  ipcMain.handle('signer:clear-seed',  ()                            => { signer.clearSeed(); });
  ipcMain.handle('signer:has-seed',    ()                            => signer.hasSeed());
  ipcMain.handle('signer:address',     (_e, hdPath: string)          => signer.deriveAddress(hdPath));
  ipcMain.handle('signer:send-tx',     (_e, hdPath: string, tx)      => signer.signAndBroadcast(hdPath, tx));
  ipcMain.handle('signer:sign-tx',     (_e, hdPath: string, tx)      => signer.signTransaction(hdPath, tx));
  ipcMain.handle('signer:personal',    (_e, hdPath: string, msg)     => signer.signPersonalMessage(hdPath, msg));
  ipcMain.handle('signer:typed-data',  (_e, hdPath: string, payload) => signer.signTypedData(hdPath, payload));
  ipcMain.handle('signer:erc20-transfer', (_e, hdPath: string, args) => signer.transferErc20(hdPath, args));

  /* Native-HID Ledger bridge — used by the renderer as a fallback when
     WebHID is unavailable (typically Linux). Lazy-loaded so a missing
     @ledgerhq/hw-transport-node-hid-noevents dep just makes `available`
     return false; the wallet still works via WebHID on macOS/Windows. */
  ipcMain.handle('ledger-native:available',   ()                            => ledgerHid.isAvailable());
  ipcMain.handle('ledger-native:get-address', (_e, hdPath?: string)         => ledgerHid.getAddress(hdPath));
  ipcMain.handle('ledger-native:sign-evm-tx', (_e, hdPath: string, hex: string) => ledgerHid.signTransaction(hdPath, hex));

  nativeTheme.themeSource = 'system';
  createWindow();
});

app.on('window-all-closed', () => {
  // Clear the cached seed before quitting so it doesn't linger in a
  // background process on macOS where the app stays alive after window
  // close.
  signer.clearSeed();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  signer.clearSeed();
  // Close any cached node-hid transport so the device is released even
  // when Electron's macOS dock lingers after window close.
  ledgerHid.dispose().catch(() => { /* best-effort */ });
});
