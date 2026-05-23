/**
 * Persistent WalletConnect host — runs inside an MV3 offscreen document
 * so the relay WebSocket stays alive even when the popup closes and the
 * background service worker idles out.
 *
 * Lifecycle:
 *   - The background service worker creates this document on install /
 *     startup (chrome.offscreen.createDocument). Chrome keeps the
 *     document alive as long as the manifest's offscreen reasons hold.
 *   - WalletKit boots on first message and stays resident; sessions
 *     resume from disk (kit persistence handles that internally).
 *
 * Message bridge (chrome.runtime):
 *   ← popup → background → here:
 *       wc.pair         { uri }                   →  { ok }
 *       wc.approve      { id, evmAddress }        →  { ok }
 *       wc.reject       { id }                    →  { ok }
 *       wc.disconnect   { topic }                 →  { ok }
 *       wc.list                                   →  { ok, sessions }
 *       wc.get-proposal                           →  { ok, proposal | null }
 *   → emitted back as broadcasts:
 *       wc.event.proposal { id, name, url }
 *       wc.event.session_delete
 *
 * Missed events while the popup was closed are stashed in
 * browser.storage.session so the popup can hydrate them on open.
 */
import { Core } from '@walletconnect/core';
import { WalletKit, type IWalletKit } from '@reown/walletkit';
import type { SessionTypes } from '@walletconnect/types';

const MAKALU = 700777;
const SUPPORTED_EVM = [MAKALU, 1, 56, 137, 8453, 42161, 59144, 10, 43114];
const NS_CHAINS = SUPPORTED_EVM.map((c) => `eip155:${c}`);
const METHODS = [
  'eth_sendTransaction', 'eth_signTransaction', 'eth_sign',
  'personal_sign', 'eth_signTypedData_v4',
  'wallet_switchEthereumChain', 'wallet_addEthereumChain',
];
const EVENTS = ['chainChanged', 'accountsChanged'];

interface PendingProposal { id: number; name: string; url: string }
let kit: IWalletKit | null = null;
let kitPromise: Promise<IWalletKit> | null = null;
let pendingProposal: PendingProposal | null = null;

function broadcast(msg: object): void {
  // Fire-and-forget; if no listener is alive (popup closed) chrome just
  // logs "could not establish connection" — that's expected.
  browser.runtime.sendMessage(msg).catch(() => { /* no listeners */ });
}

async function getKit(): Promise<IWalletKit> {
  if (kit) return kit;
  if (kitPromise) return kitPromise;
  kitPromise = (async () => {
    const projectId =
      (typeof process !== 'undefined' && process.env?.WXT_REOWN_PROJECT_ID) ||
      '6d05d9a84112ca2f7c1bb77a76a18c81';
    const core = new Core({ projectId });
    const k = await WalletKit.init({
      core,
      metadata: {
        name:        'Thanos Wallet',
        description: 'Lithosphere-first wallet — persistent WalletConnect',
        url:         'https://thanos.fi',
        icons:       ['https://thanos.fi/images/Thanos_Logo.png'],
      },
    });
    k.on('session_proposal', (p) => {
      const proposal: PendingProposal = {
        id:   p.id,
        name: p.params.proposer.metadata?.name ?? 'dApp',
        url:  p.params.proposer.metadata?.url  ?? '',
      };
      pendingProposal = proposal;
      // Stash so a popup that opens AFTER the proposal arrives can see it.
      browser.storage.session.set({ wc_pending_proposal: proposal }).catch(() => {});
      broadcast({ type: 'wc.event.proposal', ...proposal });
    });
    k.on('session_delete', () => {
      broadcast({ type: 'wc.event.session_delete' });
    });
    kit = k;
    return k;
  })();
  return kitPromise;
}

function projectSession(s: SessionTypes.Struct) {
  return {
    topic: s.topic,
    name:  s.peer?.metadata?.name ?? 'Unknown dApp',
    url:   s.peer?.metadata?.url  ?? '',
  };
}

browser.runtime.onMessage.addListener(((raw: unknown, _sender: unknown, sendResponse: (v: unknown) => void) => {
  const msg = raw as { type?: string; __target?: string; [k: string]: unknown };
  // Only the background forwards us tagged messages; ignore the popup's
  // original broadcast (background will proxy it tagged).
  if (msg?.__target !== 'offscreen') return false;
  if (!msg?.type || !msg.type.startsWith('wc.')) return false;

  (async () => {
    try {
      const k = await getKit();
      switch (msg.type) {
        case 'wc.pair':
          await k.pair({ uri: String(msg.uri ?? '') });
          sendResponse({ ok: true });
          break;
        case 'wc.approve': {
          const evm = String(msg.evmAddress ?? '');
          if (!evm) throw new Error('evmAddress required');
          const accounts = NS_CHAINS.map((c) => `${c}:${evm}`);
          await k.approveSession({
            id: Number(msg.id),
            namespaces: { eip155: { chains: NS_CHAINS, methods: METHODS, events: EVENTS, accounts } },
          });
          pendingProposal = null;
          browser.storage.session.remove('wc_pending_proposal').catch(() => {});
          sendResponse({ ok: true });
          break;
        }
        case 'wc.reject':
          await k.rejectSession({ id: Number(msg.id), reason: { code: 5000, message: 'User rejected' } });
          pendingProposal = null;
          browser.storage.session.remove('wc_pending_proposal').catch(() => {});
          sendResponse({ ok: true });
          break;
        case 'wc.disconnect':
          await k.disconnectSession({ topic: String(msg.topic ?? ''), reason: { code: 6000, message: 'User disconnected' } });
          sendResponse({ ok: true });
          break;
        case 'wc.list':
          sendResponse({ ok: true, sessions: Object.values(k.getActiveSessions()).map(projectSession) });
          break;
        case 'wc.get-proposal':
          sendResponse({ ok: true, proposal: pendingProposal });
          break;
        case 'wc.ping':
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: `unknown wc command: ${msg.type}` });
      }
    } catch (e) {
      sendResponse({ ok: false, error: (e as Error)?.message || 'wc command failed' });
    }
  })();
  return true; // we'll respond asynchronously
}) as Parameters<typeof browser.runtime.onMessage.addListener>[0]);

// Boot the kit immediately so any sessions persisted by WalletKit's
// internal storage resume + the relay reconnects without waiting for
// the first popup interaction.
void getKit().catch(() => { /* surfaced on next user action */ });
