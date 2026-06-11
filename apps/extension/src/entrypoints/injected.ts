/**
 * window.thanos provider — injected into every page's MAIN world.
 *
 * EIP-1193 compliant. dApps that detect window.ethereum will pick this up;
 * we *don't* set window.ethereum by default (avoid stomping on MetaMask /
 * other wallets that the user might also have installed). Tooling that
 * wants Thanos explicitly reads window.thanos.
 *
 * Communication: postMessage with target='thanos-content' (this script)
 *                postMessage with target='thanos-page' (content -> us).
 *
 * Methods supported in this MVP slice:
 *   - eth_requestAccounts      (opens approval popup)
 *   - eth_accounts             (auto-reply from connected list)
 *   - eth_chainId              (Makalu = 0xab169 = 700777)
 *   - wallet_switchEthereumChain
 *
 * Signing methods (eth_sendTransaction / personal_sign / etc.) are wired
 * in the next slice once the unlocked-vault bridge is in place.
 */
export default defineUnlistedScript(() => {
  if ((window as any).thanos) return; // already injected

  type PromiseFns = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
  const pending = new Map<string, PromiseFns>();
  const listeners = new Map<string, Set<(...a: unknown[]) => void>>();

  function emit(event: string, ...args: unknown[]) {
    listeners.get(event)?.forEach(fn => { try { fn(...args); } catch {} });
  }

  function sendRequest(method: string, params: unknown[] = []): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}.${Math.random().toString(36).slice(2)}`;
      pending.set(id, { resolve, reject });
      window.postMessage({ target: 'thanos-content', type: 'request', id, method, params }, '*');
    });
  }

  // Listen for responses + push events from the content bridge.
  window.addEventListener('message', evt => {
    if (evt.source !== window) return;
    const msg = evt.data as { target?: string; type?: string; id?: string; result?: unknown; error?: { code: number; message: string }; event?: string; args?: unknown[] } | null;
    if (!msg || msg.target !== 'thanos-page') return;

    if (msg.type === 'response' && msg.id) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
      else p.resolve(msg.result);
    } else if (msg.type === 'event' && msg.event) {
      emit(msg.event, ...(msg.args ?? []));
    }
  });

  const provider = {
    isThanos:           true,
    isMetaMask:         false, // explicitly false — we don't impersonate
    chainId:            '0xab169', // 700777 hex (default until we hear otherwise)
    networkVersion:     '700777',
    selectedAddress:    null as string | null,

    /** EIP-1193 request method. */
    request(args: { method: string; params?: unknown[] }) {
      if (!args || typeof args.method !== 'string') {
        return Promise.reject(new Error('Invalid request: missing method'));
      }
      return sendRequest(args.method, args.params ?? []);
    },

    on(event: string, handler: (...a: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
      return provider;
    },
    removeListener(event: string, handler: (...a: unknown[]) => void) {
      listeners.get(event)?.delete(handler);
      return provider;
    },
    /** Legacy method kept for compat with very old dApps. */
    enable() { return sendRequest('eth_requestAccounts'); },
  };

  // React to chain/account changes from the wallet.
  provider.on('chainChanged', (newChainId) => { provider.chainId = String(newChainId); });
  provider.on('accountsChanged', (accounts) => {
    const list = accounts as string[];
    provider.selectedAddress = list?.[0] ?? null;
  });

  Object.defineProperty(window, 'thanos', { value: provider, writable: false, configurable: false });

  // EIP-6963: announce the provider so dApps can discover it without stomping
  // on window.ethereum. The standard pattern for multi-wallet support.
  const info = {
    uuid:   crypto.randomUUID(),
    name:   'Thanos Wallet',
    icon:   'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI0NSIgZmlsbD0iIzNiN2FmNyIvPjwvc3ZnPg==',
    rdns:   'fi.thanos.wallet',
  };
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: Object.freeze({ info, provider }),
  }));
  window.addEventListener('eip6963:requestProvider', () => {
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: Object.freeze({ info, provider }),
    }));
  });
});
