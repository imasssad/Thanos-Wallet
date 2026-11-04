/**
 * O-01/M20 + M21 — the desktop main process's trust boundary
 * (src/main/ipc-guard.ts), tested for the first time: `apps/desktop`
 * shipped no test suite at all (O-01's remainder). The hardening-audit
 * comment at the top of ipc-guard.ts names two rules:
 *
 *   M21 — lockToApp(): the wallet window can never navigate, redirect, or
 *         open a child window onto a non-app URL.
 *   M20 — isTrustedSender() / handleTrusted(): every privileged IPC
 *         handler re-checks the call came from the app document's top
 *         frame, so a dApp WebContentsView (or an iframe) can never reach
 *         the signer/vault channels even if (1) were ever bypassed.
 *
 * ipc-guard.ts does `require('electron')` at module scope — a plain
 * `require`/`import` outside Electron's runtime resolves to the path of
 * the Electron binary (a string), not the API object, so `app.isPackaged`
 * would throw. `node:test`'s `mock.module` (run with
 * --experimental-test-module-mocks) substitutes a fake `electron` module
 * before the import, which works for both the CJS `require` and ESM
 * `import` resolution paths.
 */
import { test, mock, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

type Handler = (...args: unknown[]) => unknown;

let ipcHandlers: Map<string, Handler>;
let openedExternal: string[];
let appIsPackaged: boolean;
let packagedEntryPath: string;

before(() => {
  mock.module('electron', {
    namedExports: {
      app: {
        get isPackaged() { return appIsPackaged; },
      },
      ipcMain: {
        handle: (channel: string, listener: Handler) => { ipcHandlers.set(channel, listener); },
      },
      shell: {
        openExternal: async (url: string) => { openedExternal.push(url); },
      },
    },
  });
});

beforeEach(() => {
  ipcHandlers = new Map();
  openedExternal = [];
  appIsPackaged = false; // dev mode by default — isAppUrl checks against DEV_ORIGIN
});

async function loadGuard() {
  // Each test may flip appIsPackaged before importing; bust the module
  // cache so isAppUrl's closed-over `app.isPackaged` read is re-evaluated
  // (it's a live getter above, so a fresh import isn't strictly required,
  // but __dirname-relative packaged-path resolution below needs one).
  return import(`../src/main/ipc-guard.ts?t=${Date.now()}-${Math.random()}`);
}

test('O-01/M20: isAppUrl trusts the dev server origin only in development', async () => {
  const { isAppUrl } = await loadGuard();
  assert.equal(isAppUrl('http://localhost:5173/'), true);
  assert.equal(isAppUrl('http://localhost:5173/#/send'), true, 'hash is ignored');
  assert.equal(isAppUrl('https://evil.example/'), false);
  assert.equal(isAppUrl('http://localhost:5174/'), false, 'a different port is not the dev server');
});

test('O-01/M20: isAppUrl ignores the dev origin once packaged (THN-04 — app.isPackaged, not NODE_ENV)', async () => {
  appIsPackaged = true;
  const { isAppUrl } = await loadGuard();
  // In production the only trusted URL is the packaged index.html, which
  // this environment doesn't ship — a dev-server URL must be refused.
  assert.equal(isAppUrl('http://localhost:5173/'), false, 'packaged builds must never trust the dev server');
  assert.equal(isAppUrl('https://evil.example/'), false);
});

test('O-01/M20: isTrustedSender requires the top frame of the app document', async () => {
  const { isTrustedSender } = await loadGuard();

  const topFrameAppDoc = { senderFrame: { parent: null, url: 'http://localhost:5173/' } };
  assert.equal(isTrustedSender(topFrameAppDoc as never), true);

  const iframeInAppDoc = { senderFrame: { parent: {}, url: 'http://localhost:5173/' } };
  assert.equal(isTrustedSender(iframeInAppDoc as never), false, 'a child frame (e.g. the dApp WebContentsView) must never be trusted');

  const topFrameRemoteDoc = { senderFrame: { parent: null, url: 'https://evil.example/' } };
  assert.equal(isTrustedSender(topFrameRemoteDoc as never), false, 'the top frame of a non-app document must never be trusted');

  const noFrame = { senderFrame: null };
  assert.equal(isTrustedSender(noFrame as never), false, 'a sender with no frame (already-destroyed webContents) must never be trusted');
});

test('O-01/M20: handleTrusted rejects an untrusted sender before the listener runs', async () => {
  const { handleTrusted } = await loadGuard();
  let listenerCalls = 0;
  handleTrusted('signer:sendTx', () => { listenerCalls += 1; return 'result'; });

  const registered = ipcHandlers.get('signer:sendTx');
  assert.ok(registered, 'handleTrusted must register the channel with ipcMain.handle');

  const untrusted = { senderFrame: { parent: {}, url: 'http://localhost:5173/' } };
  assert.throws(() => registered!(untrusted), /untrusted sender/, 'an untrusted sender must be rejected, not reach the listener');
  assert.equal(listenerCalls, 0, 'the privileged listener must never run for an untrusted sender');

  const trusted = { senderFrame: { parent: null, url: 'http://localhost:5173/' } };
  const result = registered!(trusted);
  assert.equal(result, 'result');
  assert.equal(listenerCalls, 1, 'a trusted sender must reach the listener exactly once');
});

/* ── M21: lockToApp — the window-navigation lock ──────────────────────── */

function fakeWebContents() {
  const listeners = new Map<string, Handler>();
  let windowOpenHandler: ((details: { url: string }) => { action: string }) | null = null;
  const wc = {
    on: (event: string, fn: Handler) => { listeners.set(event, fn); },
    setWindowOpenHandler: (fn: typeof windowOpenHandler) => { windowOpenHandler = fn; },
  };
  return { wc, listeners, openWindow: (url: string) => windowOpenHandler!({ url }) };
}

test('O-01/M21: lockToApp cancels navigation to a non-app URL and hands it to the OS browser', async () => {
  const { lockToApp } = await loadGuard();
  const { wc, listeners } = fakeWebContents();
  lockToApp({ webContents: wc } as never);

  const willNavigate = listeners.get('will-navigate')!;
  let prevented = false;
  willNavigate({ url: 'https://evil.example/', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true, 'navigating off the app document must be cancelled');
  assert.deepEqual(openedExternal, ['https://evil.example/'], 'the URL must be handed to the default browser instead');
});

test('O-01/M21: lockToApp lets navigation within the app document through', async () => {
  const { lockToApp } = await loadGuard();
  const { wc, listeners } = fakeWebContents();
  lockToApp({ webContents: wc } as never);

  const willNavigate = listeners.get('will-navigate')!;
  let prevented = false;
  willNavigate({ url: 'http://localhost:5173/#/send', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false, 'navigating within the app document must not be cancelled');
  assert.deepEqual(openedExternal, []);
});

test('O-01/M21: lockToApp cancels a redirect to a non-app URL', async () => {
  const { lockToApp } = await loadGuard();
  const { wc, listeners } = fakeWebContents();
  lockToApp({ webContents: wc } as never);

  const willRedirect = listeners.get('will-redirect')!;
  let prevented = false;
  willRedirect({ url: 'https://evil.example/', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true, 'a redirect off the app document must be cancelled');
});

test('O-01/M21: lockToApp denies window.open / target=_blank and opens it externally instead', async () => {
  const { lockToApp } = await loadGuard();
  const { wc, openWindow } = fakeWebContents();
  lockToApp({ webContents: wc } as never);

  const result = openWindow('https://evil.example/');
  assert.equal(result.action, 'deny', 'a child window must never be created for a dApp-originated link');
  assert.deepEqual(openedExternal, ['https://evil.example/']);
});

test('O-01/M21: lockToApp denies <webview> attachment', async () => {
  const { lockToApp } = await loadGuard();
  const { wc, listeners } = fakeWebContents();
  lockToApp({ webContents: wc } as never);

  const willAttachWebview = listeners.get('will-attach-webview')!;
  let prevented = false;
  willAttachWebview({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true, 'a page-created <webview> must never be allowed to attach');
});

test('O-01/M21: openInBrowser only ever opens http(s), never file:/javascript:/custom schemes', async () => {
  const { openInBrowser } = await loadGuard();
  openInBrowser('javascript:alert(1)');
  openInBrowser('file:///etc/passwd');
  openInBrowser('custom-scheme://evil');
  assert.deepEqual(openedExternal, [], 'non-http(s) schemes must never reach shell.openExternal');

  openInBrowser('https://example.com/');
  assert.deepEqual(openedExternal, ['https://example.com/']);
});
