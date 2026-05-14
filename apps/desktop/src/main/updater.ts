/**
 * electron-updater wiring for the main process.
 *
 * Lifecycle
 *   1. App boot → startAutoUpdater(window)
 *   2. autoUpdater.checkForUpdatesAndNotify() fires immediately
 *   3. Poll every hour after that
 *   4. UI events (`update-available`, download-progress, `update-downloaded`,
 *      `error`) → ipcMain → ipcRenderer in the renderer → banner UI
 *   5. User clicks Install → ipcMain.handle('updater:install') →
 *      autoUpdater.quitAndInstall(false, true)
 *
 * Skipped entirely in development (NODE_ENV === 'development') and when
 * the app is unpackaged (`app.isPackaged` false). For local testing of
 * the update flow set `UPDATER_FORCE_DEV=1` and put a `dev-app-update.yml`
 * next to the app root pointing at a test feed.
 *
 * Logs route through electron-log to ~/.config/Thanos Wallet/logs/main.log
 * (Linux) / Library/Logs (macOS) / %APPDATA%\Roaming\Thanos Wallet\logs
 * (Windows). Helps debug update issues from user reports.
 */

const { app, ipcMain } = require('electron') as typeof import('electron');
const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
const electronLog = require('electron-log') as typeof import('electron-log');
import type { BrowserWindow } from 'electron';

const ONE_HOUR_MS = 60 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
autoUpdater.logger = electronLog as any;
electronLog.transports.file.level = 'info';

let _window: BrowserWindow | null = null;
let _started = false;

type UpdateEvent =
  | { kind: 'checking' }
  | { kind: 'available';   version: string; releaseNotes?: string | null }
  | { kind: 'not-available' }
  | { kind: 'progress';    percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { kind: 'downloaded';  version: string; releaseNotes?: string | null }
  | { kind: 'error';       message: string };

function emit(ev: UpdateEvent): void {
  if (!_window || _window.isDestroyed()) return;
  _window.webContents.send('updater:event', ev);
}

/** Hook up the renderer-bound IPC handlers + autoUpdater event stream
 *  + the periodic check. Idempotent — safe to call repeatedly. */
export function startAutoUpdater(window: BrowserWindow): void {
  _window = window;
  if (_started) return;
  _started = true;

  /* Disable auto-download by default: we want the user to opt in via the
     banner before consuming their bandwidth on a wallet that's running
     unattended. The renderer can flip this via ipc if we add a
     "background updates" preference later. */
  autoUpdater.autoDownload          = true;
  autoUpdater.autoInstallOnAppQuit  = true;
  autoUpdater.allowPrerelease       = false;

  autoUpdater.on('checking-for-update', () => emit({ kind: 'checking' }));
  autoUpdater.on('update-available', info => emit({
    kind: 'available',
    version: info.version,
    releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
  }));
  autoUpdater.on('update-not-available', () => emit({ kind: 'not-available' }));
  autoUpdater.on('download-progress', p => emit({
    kind:           'progress',
    percent:        p.percent,
    transferred:    p.transferred,
    total:          p.total,
    bytesPerSecond: p.bytesPerSecond,
  }));
  autoUpdater.on('update-downloaded', info => emit({
    kind: 'downloaded',
    version: info.version,
    releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
  }));
  autoUpdater.on('error', err => emit({ kind: 'error', message: (err as Error).message || 'updater error' }));

  ipcMain.handle('updater:check',  () => autoUpdater.checkForUpdates().catch(e => ({ error: (e as Error).message })));
  ipcMain.handle('updater:install', () => {
    // false = don't silent-install (show progress); true = force-close even
    // if app is still busy. The user's intent is explicit at this point.
    autoUpdater.quitAndInstall(false, true);
  });

  // Skip in dev unless explicitly forced. Unpackaged builds don't have
  // an update.json to compare against; electron-updater would 404.
  if (!app.isPackaged && process.env.UPDATER_FORCE_DEV !== '1') {
    electronLog.info('updater: skipped (NODE_ENV development / not packaged)');
    return;
  }

  // First check after the window has had a moment to render — keeps the
  // app launch perception snappy.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => {
      electronLog.warn('updater: initial check failed:', (err as Error).message);
    });
  }, 5_000);

  // Periodic check. Cleared automatically on process exit.
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(err => {
      electronLog.warn('updater: periodic check failed:', (err as Error).message);
    });
  }, ONE_HOUR_MS);
}
