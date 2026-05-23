// Use require() directly — Electron's module interceptor matches the literal "electron" string
// and TS's __importDefault interop wrapper sometimes breaks this with pnpm symlinks
const { app, BrowserWindow, ipcMain, nativeTheme, shell, session } = require('electron') as typeof import('electron');

/* USB / HID vendor IDs we let the renderer enumerate. Hardware-wallet
   manufacturers only — never a blanket "allow all devices" handler. */
const LEDGER_VENDOR_ID  = 0x2c97;
const TREZOR_VENDOR_IDS = [0x534c, 0x1209]; // Trezor One / Trezor T (Trezor Co.)
const HW_VENDOR_IDS     = new Set([LEDGER_VENDOR_ID, ...TREZOR_VENDOR_IDS]);
const path = require('path') as typeof import('path');
import { startAutoUpdater } from './updater';

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
      preload: path.join(__dirname, 'preload.js')
    }
  });

  /* Hardware-wallet USB / HID transport — Electron denies device access
     by default. We allow Ledger / Trezor vendor IDs only so the
     renderer's @ledgerhq/hw-transport-webhid + @trezor/connect-web can
     enumerate the device. Other vendors stay denied. */
  const sess = win.webContents.session;
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

  // electron-updater starts polling once the renderer is mounted so the
  // banner UI is ready to receive `updater:event` IPC messages.
  startAutoUpdater(win);
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

  nativeTheme.themeSource = 'system';
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
