'use client';
/**
 * Listens for incoming WalletConnect session_request events (after the user
 * has approved a session via WalletConnectModal) and answers them.
 *
 * Routing lives in lib/wc-requests.ts (pure, unit-tested): every
 * personal_sign / eth_signTypedData_v4 / eth_sendTransaction waits for the
 * user in the confirm sheet below, decoded by sdk-core reviewSigningRequest
 * (permits, Permit2, Seaport, approve, … into spender / amount / "you give,
 * you get"). A `block` verdict can only be rejected. Requests queue — a new
 * one never replaces the sheet on screen. Signing runs in the web worker,
 * falling back to the main thread only if the worker isn't up.
 *
 * Mount this once inside the AppShell so it survives navigation.
 */
import { useEffect, useRef, useState } from 'react';
import type { WalletKitTypes } from '@reown/walletkit';
import { useWallet } from './shell/AppShell';
import {
  onSessionRequest, respondRequest, respondError,
  emitChainChanged,
} from '../lib/walletconnect';
import { Wallet as EthersWallet } from 'ethers';
import { walletFromSeed, makeProvider } from '../lib/signer';
import {
  signerSignMessage, signerSignTypedData, signerSignTransaction, SignerError,
} from '../lib/signer-client';
import { classifyOrigin } from '../lib/phishing';
import { createSessionRequestHandler, type ConfirmEntry } from '../lib/wc-requests';
import { SignReviewPanel } from './SignReviewPanel';
import { EVM_CHAINS } from '../lib/evm-chains';
import { MAKALU_CHAIN_ID } from '../lib/rpc';

type PendingRequest = ConfirmEntry<WalletKitTypes.SessionRequest>;

/** The dApp origin WalletConnect verified for this request, if any. */
function requestOrigin(request: WalletKitTypes.SessionRequest): string | undefined {
  return (request as unknown as { verifyContext?: { verified?: { origin?: string } } }).verifyContext?.verified?.origin;
}

/** Worker first; on worker_locked / worker_crashed (early cold start) fall
 *  back to signing in-process so the request doesn't fail outright. */
async function withWorker<T>(viaWorker: () => Promise<T>, inProcess: () => Promise<T>): Promise<T> {
  try {
    return await viaWorker();
  } catch (wErr) {
    const code = wErr instanceof SignerError ? wErr.code : '';
    if (code === 'worker_locked' || code === 'worker_crashed') return inProcess();
    throw wErr;
  }
}

export function WalletConnectHost() {
  const wallet = useWallet();
  const seed   = wallet?.seed ?? [];
  const pk     = wallet?.privateKey;
  const evm    = wallet?.evmAddress ?? '';

  // Latest values without retriggering the subscribe effect on every change.
  const seedRef = useRef(seed); seedRef.current = seed;
  const pkRef   = useRef(pk);   pkRef.current   = pk;
  const evmRef  = useRef(evm);  evmRef.current  = evm;

  /** Build an ethers Wallet for the current unlock — either from the HD seed
   *  or from a raw private key — without leaking the secret beyond this fn. */
  const currentWallet = (provider?: Parameters<typeof walletFromSeed>[1]) => {
    if (pkRef.current) {
      const w = new EthersWallet(pkRef.current);
      return provider ? (w.connect(provider) as EthersWallet) : w;
    }
    return walletFromSeed(seedRef.current, provider);
  };

  /* ─── Per-session active chain ─────────────────────────────────────
     WC v2 negotiates namespaces at session approval time. dApps that
     want to switch chains mid-session call `wallet_switchEthereumChain`
     — we honour it by storing the new chainId for that topic and
     emitting a `chainChanged` event so the dApp re-reads. The
     in-memory map is intentionally per-mount: WC sessions don't span
     refreshes anyway, and on cold start dApps will re-negotiate. */
  const SUPPORTED_CHAIN_IDS = new Set<number>([
    MAKALU_CHAIN_ID,
    ...EVM_CHAINS.map(c => c.chainId),
  ]);
  const sessionChainsRef = useRef<Map<string, number>>(new Map());

  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [busy, setBusy]       = useState<'approve' | 'reject' | null>(null);

  /* Every signing request waits for the user, one at a time: later ones
     queue behind the sheet on screen instead of replacing it (a page must
     not be able to swap the request just before the user taps Approve). */
  const queueRef = useRef<PendingRequest[]>([]);
  const [queued, setQueued] = useState(0);
  const queueForConfirm = (entry: PendingRequest) => {
    queueRef.current.push(entry);
    setQueued(queueRef.current.length);
    if (queueRef.current.length === 1) setPending(queueRef.current[0]);
  };
  const advanceQueue = () => {
    queueRef.current.shift();
    setQueued(queueRef.current.length);
    setPending(queueRef.current[0] ?? null);
    setBusy(null);
  };

  useEffect(() => {
    let unsub: (() => void) | undefined;
    const handler = createSessionRequestHandler<WalletKitTypes.SessionRequest>({
      account: () => evmRef.current,
      sessionChainId: (topic) => sessionChainsRef.current.get(topic) ?? MAKALU_CHAIN_ID,
      setSessionChainId: (topic, chainId) => { sessionChainsRef.current.set(topic, chainId); },
      supportedChainIds: SUPPORTED_CHAIN_IDS,
      // The signing worker (and its fallback) broadcast on Makalu.
      broadcastChainId: MAKALU_CHAIN_ID,
      respond: (topic, id, result) => respondRequest({ topic, id, result }),
      respondError: (topic, id, code, message) => respondError({ topic, id, code, message }),
      emitChainChanged,
      signMessage: (messageHex) => withWorker(
        async () => (await signerSignMessage(messageHex)).signature,
        () => currentWallet().signMessage(messageHex.startsWith('0x')
          ? Buffer.from(messageHex.slice(2), 'hex')
          : new TextEncoder().encode(messageHex)),
      ),
      signTypedData: (typed) => withWorker(
        async () => (await signerSignTypedData(typed)).signature,
        () => currentWallet().signTypedData(typed.domain, typed.types, typed.message),
      ),
      sendTransaction: (tx) => withWorker(
        async () => (await signerSignTransaction(tx)).hash,
        async () => (await currentWallet(makeProvider()).sendTransaction({
          to: tx.to,
          value: tx.value ? BigInt(tx.value) : undefined,
          data: tx.data,
          gasLimit: tx.gasLimit,
          maxFeePerGas: tx.maxFeePerGas,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        })).hash,
      ),
      confirm: queueForConfirm,
      blockedOrigin: (origin) => {
        const v = classifyOrigin(origin);
        return v.risk === 'critical' ? (v.reasons[0] ?? 'Known phishing site.') : null;
      },
    });
    onSessionRequest(handler)
      .then(fn => { unsub = fn; })
      .catch(() => {});

    return () => { if (unsub) unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount once; refs keep latest seed/address

  /* ─── Confirm sheet — every signing request, one at a time ─────────── */
  if (!pending) return null;

  const close   = advanceQueue;
  const blocked = pending.review.risk === 'block';
  const onApprove = async () => {
    if (busy || blocked) return;
    setBusy('approve');
    try { await pending.approve(); } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[wc] approve failed:', (e as Error).message);
    }
    close();
  };
  const onReject = async () => {
    if (busy) return;
    setBusy('reject');
    try { await pending.reject(); } catch { /* dApp may already have given up */ }
    close();
  };

  const peer = pending.request.params?.request as { method?: string } | undefined;
  const dAppName = requestOrigin(pending.request) ?? 'dApp';

  /* Chain badge — every WC v2 request carries its EIP-155 chainId in
     `params.chainId` (e.g. "eip155:137"). Resolve to a human label so
     the user sees the network at sign time. */
  const reqChain = ((): { id: number; label: string } | null => {
    const raw = (pending.request.params as { chainId?: string } | undefined)?.chainId;
    if (typeof raw !== 'string' || !raw.startsWith('eip155:')) return null;
    const id = parseInt(raw.slice('eip155:'.length), 10);
    if (!Number.isFinite(id)) return null;
    const known = EVM_CHAINS.find(c => c.chainId === id);
    const label = known?.name ?? (id === MAKALU_CHAIN_ID ? 'Lithosphere Makalu' : `Chain ${id}`);
    return { id, label };
  })();

  return (
    <div className="modal-backdrop" onClick={onReject}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <span className="modal-title">Confirm signing</span>
          <button className="modal-close" onClick={onReject}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
            <span>{dAppName} · {peer?.method}</span>
            {reqChain && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 6px', borderRadius: 4,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-secondary)',
                fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
              }}>
                {reqChain.label.toUpperCase()}
              </span>
            )}
          </div>
          <SignReviewPanel review={pending.review}/>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              className="btn-outline"
              style={{ flex: 1 }}
              onClick={onReject}
              disabled={busy === 'approve'}
            >
              {busy === 'reject' ? 'Rejecting…' : 'Reject'}
            </button>
            {!blocked && (
              <button
                className="btn-primary"
                style={{
                  flex: 1,
                  background: pending.review.risk === 'review' ? 'var(--red)' : undefined,
                  opacity: busy ? 0.6 : 1,
                }}
                onClick={onApprove}
                disabled={busy === 'reject'}
              >
                {busy === 'approve'
                  ? 'Signing…'
                  : pending.review.risk === 'review' ? 'I understand — sign' : 'Approve & sign'}
              </button>
            )}
          </div>
          {queued > 1 && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
              {queued - 1} more request{queued > 2 ? 's' : ''} waiting
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
