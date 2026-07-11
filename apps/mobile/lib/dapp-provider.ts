/**
 * EIP-1193 provider injection for the in-app dApp browser.
 *
 * INJECTED_PROVIDER_JS runs in the WebView page BEFORE site code loads
 * and defines `window.ethereum` — a minimal EIP-1193 provider that
 * forwards every request to React Native via postMessage and resolves
 * once RN posts a response back (resolveJs / rejectJs). The RN side
 * (InAppBrowser) decides which methods auto-resolve and which need a
 * user approval sheet, then signs with the wallet seed via
 * executeWcRequest (shared with WalletConnect).
 *
 * Security: the seed never enters the WebView. The page can only ask;
 * RN signs after the user approves. isMetaMask is emulated because many
 * dApps gate their connect button on it.
 */

const MAKALU_CHAIN_HEX = `0x${(700777).toString(16)}`; // 0xab169

export const INJECTED_PROVIDER_JS = `(function () {
  if (window.ethereum && window.ethereum.__thanos) return;
  var cbs = {}, nextId = 1, listeners = {};
  var CHAIN_ID = '${MAKALU_CHAIN_HEX}';

  // Bytes-like sign params must become 0x hex BEFORE JSON.stringify —
  // a Uint8Array stringifies to {"0":105,…}, which the wallet side can't
  // treat as the message the dApp meant (same class of bug as the
  // extension's runtime.sendMessage boundary). NOTE: plain string, no
  // backslash escapes — this source is embedded in a TS template literal.
  function toHexBytes(v) {
    var b = null, i;
    if (typeof Uint8Array !== 'undefined' && v instanceof Uint8Array) b = v;
    else if (typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer) b = new Uint8Array(v);
    else if (Object.prototype.toString.call(v) === '[object Array]') b = v;
    else if (v && typeof v === 'object') {
      var ks = Object.keys(v), ok = ks.length > 0;
      for (i = 0; i < ks.length; i++) if (!/^[0-9]+$/.test(ks[i])) { ok = false; break; }
      if (ok) {
        ks.sort(function (a, c) { return a - c; });
        b = [];
        for (i = 0; i < ks.length; i++) b.push(v[ks[i]]);
      }
    }
    if (!b) return null;
    var h = '0x', n;
    for (i = 0; i < b.length; i++) {
      n = b[i];
      if (typeof n !== 'number' || n !== Math.floor(n) || n < 0 || n > 255) return null;
      h += (n < 16 ? '0' : '') + n.toString(16);
    }
    return h;
  }
  function normSignParams(method, params) {
    var idx = method === 'personal_sign' ? 0 : method === 'eth_sign' ? 1 : -1;
    if (idx < 0 || !params || params.length <= idx) return params;
    var hx = toHexBytes(params[idx]);
    if (hx == null) return params;
    var out = params.slice();
    out[idx] = hx;
    return out;
  }

  function rpc(method, params) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      cbs[id] = { resolve: resolve, reject: reject };
      window.ReactNativeWebView.postMessage(JSON.stringify({
        __thanos: true, id: id, method: method, params: normSignParams(method, params || [])
      }));
    });
  }

  window.__thanos_resolve = function (id, result) {
    var cb = cbs[id]; if (!cb) return; delete cbs[id]; cb.resolve(result);
  };
  window.__thanos_reject = function (id, error) {
    var cb = cbs[id]; if (!cb) return; delete cbs[id];
    cb.reject({ code: (error && error.code) || 4001, message: (error && error.message) || 'User rejected' });
  };
  window.__thanos_emit = function (event, data) {
    (listeners[event] || []).slice().forEach(function (fn) { try { fn(data); } catch (e) {} });
  };

  var provider = {
    __thanos: true,
    isMetaMask: true,
    isThanos: true,
    chainId: CHAIN_ID,
    networkVersion: '700777',
    selectedAddress: null,
    request: function (args) {
      var method = args && args.method, params = args && args.params;
      return rpc(method, params).then(function (res) {
        if ((method === 'eth_requestAccounts' || method === 'eth_accounts') && res && res.length) {
          provider.selectedAddress = res[0];
          window.__thanos_emit('accountsChanged', res);
        }
        if (method === 'eth_chainId') { provider.chainId = res; window.__thanos_emit('chainChanged', res); }
        return res;
      });
    },
    enable: function () { return provider.request({ method: 'eth_requestAccounts' }); },
    // Legacy compatibility shims.
    send: function (m, p) {
      if (typeof m === 'string') return provider.request({ method: m, params: p });
      return provider.request(m);
    },
    sendAsync: function (payload, cb) {
      provider.request(payload).then(
        function (r) { cb(null, { id: payload.id, jsonrpc: '2.0', result: r }); },
        function (e) { cb(e, null); }
      );
    },
    on: function (event, handler) { (listeners[event] = listeners[event] || []).push(handler); return provider; },
    removeListener: function (event, handler) {
      listeners[event] = (listeners[event] || []).filter(function (f) { return f !== handler; }); return provider;
    },
  };

  window.ethereum = provider;
  try { window.dispatchEvent(new Event('ethereum#initialized')); } catch (e) {}
})();
true;`;

/** JS to resolve a pending request inside the page. */
export function resolveJs(id: number, result: unknown): string {
  return `window.__thanos_resolve(${id}, ${JSON.stringify(result)}); true;`;
}

/** JS to reject a pending request inside the page. */
export function rejectJs(id: number, code: number, message: string): string {
  return `window.__thanos_reject(${id}, ${JSON.stringify({ code, message })}); true;`;
}

/** Methods that require an explicit user approval sheet. */
export const APPROVAL_METHODS = new Set([
  'eth_requestAccounts',
  'personal_sign',
  'eth_sign',
  'eth_signTypedData',
  'eth_signTypedData_v4',
  'eth_sendTransaction',
]);
