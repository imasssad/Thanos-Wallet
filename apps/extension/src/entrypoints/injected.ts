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
import { normalizeSignParams } from '../lib/bytes-normalize';

export default defineUnlistedScript(() => {
  if ((window as any).thanos) return; // already injected

  type PromiseFns = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
  const pending = new Map<string, PromiseFns>();
  const listeners = new Map<string, Set<(...a: unknown[]) => void>>();

  function emit(event: string, ...args: unknown[]) {
    listeners.get(event)?.forEach(fn => { try { fn(...args); } catch {} });
  }

  function sendRequest(method: string, params: unknown[] = []): Promise<unknown> {
    // Normalize bytes-like sign params to 0x hex HERE — this is the last
    // point where a dApp's Uint8Array is still real bytes. The next hop
    // (content script → background) serializes as JSON, which mangles a
    // Uint8Array into {0:…,1:…} and breaks signing downstream.
    const safeParams = normalizeSignParams(method, params);
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}.${Math.random().toString(36).slice(2)}`;
      pending.set(id, { resolve, reject });
      window.postMessage({ target: 'thanos-content', type: 'request', id, method, params: safeParams }, '*');
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

  // Sync the cached chainId to the wallet's ACTUAL active chain on load — the
  // wallet can now switch across EVM networks, so the 0xab169 default is only
  // a hint until this resolves. If it differs, EMIT chainChanged too: wagmi
  // and other libs cache the chain on connect from provider.chainId, so
  // without this a dApp reconnecting while the wallet is on (say) Ethereum
  // would keep thinking it's on Makalu.
  sendRequest('eth_chainId')
    .then((id) => {
      if (typeof id === 'string' && id && id !== provider.chainId) {
        provider.chainId = id;
        provider.networkVersion = String(parseInt(id, 16));
        emit('chainChanged', id);
      }
    })
    .catch(() => { /* not connected / background asleep — keep the default */ });

  // EIP-6963: announce the provider so dApps can discover it without stomping
  // on window.ethereum. The standard pattern for multi-wallet support.
  const info = {
    uuid:   crypto.randomUUID(),
    name:   'Thanos Wallet',
    icon:   'data:image/png;base64,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',
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
