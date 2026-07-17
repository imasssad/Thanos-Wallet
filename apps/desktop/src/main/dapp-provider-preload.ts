/**
 * dApp-browser provider preload — desktop.
 *
 * Injects window.ethereum + window.thanos (EIP-1193) into the SANDBOXED
 * in-app browser WebContentsView so a dApp — e.g. Quantt's "Sign in with
 * Thanos" — can talk to the wallet. The page NEVER sees the seed: every
 * request forwards over IPC to main (`dapp:rpc`), which shows the approval
 * dialog and relays signing to the wallet renderer (see dapp-browser.ts +
 * DappRequestHost.tsx).
 *
 * Why the provider lives in the MAIN world (injected via webFrame), not
 * exposed through contextBridge: contextBridge COPIES data properties at
 * expose time (so selectedAddress/chainId would freeze at their initial
 * values), does NOT preserve function identity across the boundary (so
 * removeListener could never match a handler), and STRIPS custom Error
 * properties (so a rejected request would lose its JSON-RPC `code`, e.g.
 * 4001 user-rejected). Defining the provider in the page's own realm keeps
 * state live, listeners real, and Errors intact. The isolated preload world
 * exposes only a thin request/event bridge; RPC-level errors come back as a
 * sentinel object (never a rejection) so the `code` survives IPC, and the
 * main-world provider re-inflates it into a real Error. EIP-6963 announce
 * also works here — a CustomEvent from the isolated world wouldn't reach the
 * page. webFrame.executeJavaScript runs at document-start, before page
 * scripts, and bypasses the page CSP.
 */
import { contextBridge, ipcRenderer, webFrame } from 'electron';

// ── Isolated-world bridge ────────────────────────────────────────────────
const emitListeners: Array<(p: { event?: string; data?: unknown }) => void> = [];
ipcRenderer.on('dapp:emit', (_e, payload: { event?: string; data?: unknown } | null) => {
  if (!payload) return;
  emitListeners.slice().forEach((cb) => { try { cb(payload); } catch { /* a listener threw — ignore */ } });
});

contextBridge.exposeInMainWorld('__thanosDappBridge', {
  // Resolves with the RPC result, or a sentinel { __thanosError, code, message }
  // — never rejects for RPC-level errors, so the code survives to the page.
  request: (method: string, params: unknown[]) => ipcRenderer.invoke('dapp:rpc', { method, params }),
  onEmit: (cb: (p: { event?: string; data?: unknown }) => void) => { emitListeners.push(cb); },
});

// ── Main-world provider (page realm) ─────────────────────────────────────
const ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI0NSIgZmlsbD0iIzNiN2FmNyIvPjwvc3ZnPg==';

const MAIN_WORLD_PROVIDER = `(function () {
  if (window.ethereum && window.ethereum.__thanos) return;
  var bridge = window.__thanosDappBridge;
  if (!bridge) return;
  var CHAIN_HEX = '0xab169';
  var listeners = {};
  function emit(event, data) {
    (listeners[event] || []).slice().forEach(function (fn) { try { fn(data); } catch (e) {} });
  }
  var provider = {
    __thanos: true, isThanos: true, isMetaMask: false,
    chainId: CHAIN_HEX, networkVersion: '700777', selectedAddress: null,
    request: function (args) {
      if (!args || typeof args.method !== 'string') return Promise.reject(new Error('Invalid request: expected { method }'));
      return bridge.request(args.method, args.params || []).then(function (res) {
        if (res && res.__thanosError) { var err = new Error(res.message); err.code = res.code; throw err; }
        if ((args.method === 'eth_requestAccounts' || args.method === 'eth_accounts') && res && res.length) provider.selectedAddress = res[0];
        if (args.method === 'eth_chainId' && typeof res === 'string') provider.chainId = res;
        return res;
      });
    },
    on: function (event, handler) { (listeners[event] = listeners[event] || []).push(handler); return provider; },
    removeListener: function (event, handler) { listeners[event] = (listeners[event] || []).filter(function (f) { return f !== handler; }); return provider; },
    enable: function () { return provider.request({ method: 'eth_requestAccounts' }); },
    send: function (m, p) { return typeof m === 'string' ? provider.request({ method: m, params: p }) : provider.request(m); },
    sendAsync: function (payload, cb) { provider.request(payload).then(function (r) { cb(null, { id: payload.id, jsonrpc: '2.0', result: r }); }, function (e) { cb(e, null); }); }
  };
  bridge.onEmit(function (payload) {
    if (!payload || !payload.event) return;
    if (payload.event === 'accountsChanged') provider.selectedAddress = (payload.data && payload.data[0]) || null;
    if (payload.event === 'chainChanged' && typeof payload.data === 'string') provider.chainId = payload.data;
    emit(payload.event, payload.data);
  });
  try { Object.defineProperty(window, 'ethereum', { value: provider, configurable: true, writable: false }); }
  catch (e) { window.ethereum = provider; }
  window.thanos = provider;
  try { window.dispatchEvent(new Event('ethereum#initialized')); } catch (e) {}
  var info = {
    uuid: (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : ('thanos-' + Date.now()),
    name: 'Thanos Wallet',
    icon: '${ICON}',
    rdns: 'fi.thanos.wallet'
  };
  function announce() {
    try { window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: info, provider: provider }) })); } catch (e) {}
  }
  announce();
  window.addEventListener('eip6963:requestProvider', announce);
})();`;

webFrame.executeJavaScript(MAIN_WORLD_PROVIDER).catch(() => { /* main-world inject failed — page keeps no provider */ });
