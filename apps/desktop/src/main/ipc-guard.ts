/**
 * Trust boundary for the wallet window's privileged IPC.
 *
 * The preload exposes the main-process signer (which holds the unlocked
 * seed), the keychain vault, and the shell / clipboard bridges to whatever
 * document the wallet window is showing — Electron keeps a webContents'
 * preload across navigations. So if the window ever lands on a remote page
 * (a link without target, a dropped link or file, injected markup setting
 * `location`), that page can call `thanosDesktop.signer.sendTx(...)` or
 * `vaultGet('thanos.vault')` directly. Two rules close that:
 *
 *   1. lockToApp(): the wallet window can never navigate, redirect, or open a
 *      child window onto a non-app URL. http(s) targets go to the user's
 *      default browser instead (what the renderer's openExternal intends).
 *   2. handleTrusted(): every privileged handler re-checks that the call came
 *      from the TOP frame of the app document. Defence in depth if (1) is ever
 *      bypassed, and it keeps the dApp WebContentsView (its own preload and
 *      its own `dapp:rpc` channel) off these channels.
 */
const { ipcMain, shell } = require('electron') as typeof import('electron');
const path = require('path') as typeof import('path');
const { pathToFileURL } = require('url') as typeof import('url');
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron';

/** Vite dev server the development build loads (see createWindow). */
const DEV_ORIGIN = 'http://localhost:5173';

function normalisePath(p: string): string {
  // Windows file URLs can differ only in drive-letter / path case.
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

/** True iff `raw` is the wallet's own document — the packaged index.html
 *  (file://) in production, or the Vite dev server in development. Query and
 *  hash are ignored; any other document is untrusted. */
export function isAppUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (process.env.NODE_ENV === 'development') return u.origin === DEV_ORIGIN;
  if (u.protocol !== 'file:') return false;
  const entry = new URL(pathToFileURL(path.join(__dirname, 'index.html')).href);
  return normalisePath(decodeURIComponent(u.pathname)) === normalisePath(decodeURIComponent(entry.pathname));
}

/** Open an http(s) URL in the user's default browser. Anything else (file:,
 *  javascript:, custom protocol handlers) is dropped. */
export function openInBrowser(url: string): void {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') void shell.openExternal(url);
  } catch { /* malformed URL — ignore */ }
}

/** Pin the wallet window to the app document (rule 1 above). */
export function lockToApp(win: BrowserWindow): void {
  const wc = win.webContents;
  wc.on('will-navigate', (e) => {
    if (isAppUrl(e.url)) return;
    e.preventDefault();
    openInBrowser(e.url);
  });
  wc.on('will-redirect', (e) => {
    if (!isAppUrl(e.url)) e.preventDefault();
  });
  // target=_blank / window.open would otherwise create a new in-app
  // BrowserWindow showing the remote page — deny it and hand the URL to the
  // user's browser instead.
  wc.setWindowOpenHandler(({ url }) => {
    openInBrowser(url);
    return { action: 'deny' };
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
}

/** True iff an IPC message came from the top frame of the app document. */
export function isTrustedSender(e: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const frame = e.senderFrame;
  return !!frame && frame.parent === null && isAppUrl(frame.url);
}

/** ipcMain.handle, restricted to the wallet window's own document (rule 2).
 *  Untrusted callers get a rejected invoke(). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleTrusted(channel: string, listener: (e: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!isTrustedSender(e)) throw new Error(`${channel}: untrusted sender`);
    return listener(e, ...args);
  });
}
