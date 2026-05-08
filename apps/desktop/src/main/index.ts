// Use require() directly — Electron's module interceptor matches the literal "electron" string
// and TS's __importDefault interop wrapper sometimes breaks this with pnpm symlinks
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron') as typeof import('electron');
const path = require('path') as typeof import('path');

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

  if (process.env.NODE_ENV === 'development') win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, 'index.html'));
};

app.whenReady().then(() => {
  // Register IPC handlers AFTER app is ready
  ipcMain.handle('vault:get',    (_e, key: string)               => keytar?.getPassword(SERVICE, key)    ?? null);
  ipcMain.handle('vault:set',    (_e, key: string, value: string) => keytar?.setPassword(SERVICE, key, value));
  ipcMain.handle('vault:remove', (_e, key: string)               => keytar?.deletePassword(SERVICE, key));

  nativeTheme.themeSource = 'system';
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
