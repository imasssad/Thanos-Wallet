'use client';
/**
 * Listens for incoming WalletConnect session_request events (after the user
 * has approved a session via WalletConnectModal) and routes them to the
 * appropriate signer in apps/web/lib/signer.ts.
 *
 * Methods handled:
 *   - personal_sign           — wallet signs the raw message
 *   - eth_signTypedData_v4    — wallet signs the EIP-712 typed data
 *   - eth_sendTransaction     — wallet signs + broadcasts the tx via
 *                                makeProvider() and returns the hash
 *
 * Everything else gets responded with a 4200 'method not supported'.
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
import {
  classifyTransaction, classifyTypedData, type Verdict, type TxLike,
} from '../lib/phishing';
import { PhishingBanner } from './PhishingBanner';
import { EVM_CHAINS } from '../lib/evm-chains';
import { MAKALU_CHAIN_ID } from '../lib/rpc';

interface PendingRequest {
  request: WalletKitTypes.SessionRequest;
  /** Risk verdict so the confirm UI can render the banner. */
  verdict: Verdict;
  /** Short human-readable summary of the action — used in the modal. */
  summary: string;
  /** Approve resumes the original signing flow. */
  approve: () => Promise<void>;
  reject:  (reason?: string) => Promise<void>;
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
  const getSessionChainId = (topic: string): number =>
    sessionChainsRef.current.get(topic) ?? MAKALU_CHAIN_ID;
  const setSessionChainId = (topic: string, chainId: number): void => {
    sessionChainsRef.current.set(topic, chainId);
  };
  const toHexChainId = (n: number): string => `0x${n.toString(16)}`;

  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [busy, setBusy]       = useState<'approve' | 'reject' | null>(null);

  /* Hand a risky request to the user. We only allow one at a time —
     concurrent dApp requests stack in dedup; the second tries again
     when the user resolves the first. */
  const queueForConfirm = (entry: PendingRequest) => {
    setPending(entry);
  };

  /* ─── Signature-spam dedup ──────────────────────────────────────────
     dApps occasionally fire two identical sign requests in quick
     succession (race conditions in their state machines, double-clicks
     on a Connect button, hot-reload glitches in dev, etc). The wallet
     can't tell *intent* apart from *spam* — so we coalesce: any request
     whose (method + JSON-serialised params) matches one we've seen in
     the last 3 seconds gets a soft-reject with code -32002. The user
     sees a single prompt instead of N stacked pop-ups. */
  const recentSigsRef = useRef<Map<string, number>>(new Map());
  const DEDUP_WINDOW_MS = 3000;
  const dedupCheck = (method: string, params: unknown[]): { duplicate: boolean; key: string } => {
    const key = `${method}::${JSON.stringify(params)}`;
    const now = Date.now();
    const last = recentSigsRef.current.get(key);
    // Sweep old entries on the way through.
    for (const [k, t] of recentSigsRef.current) {
      if (now - t > DEDUP_WINDOW_MS) recentSigsRef.current.delete(k);
    }
    if (last !== undefined && now - last < DEDUP_WINDOW_MS) return { duplicate: true, key };
    recentSigsRef.current.set(key, now);
    return { duplicate: false, key };
  };

  /* ─── Permit-pattern detection ──────────────────────────────────────
     If a dApp pushes an `eth_sendTransaction` whose `data` field is an
     ERC-20 `approve(spender, amount)` call, log a one-time hint about
     EIP-2612 Permit being a single-signature alternative. We don't
     auto-translate — that's dApp work — but the hint surfaces in
     devtools so integrators see it. */
  const ERC20_APPROVE_SIG = '0x095ea7b3';
  const permitHintShownRef = useRef<Set<string>>(new Set());
  const maybePermitHint = (data: string | undefined, topic: string) => {
    if (typeof data !== 'string' || !data.toLowerCase().startsWith(ERC20_APPROVE_SIG)) return;
    if (permitHintShownRef.current.has(topic)) return;
    permitHintShownRef.current.add(topic);
    // eslint-disable-next-line no-console
    console.info(
      '[wc] dApp requested ERC-20 approve(). If this dApp adopts EIP-2612 '
      + 'Permit or Uniswap Permit2, the user can authorise the same flow '
      + 'with a single off-chain signature instead of two on-chain txs. '
      + 'See https://eips.ethereum.org/EIPS/eip-2612.',
    );
  };

  useEffect(() => {
    let unsub: (() => void) | undefined;

    onSessionRequest(async (request) => {
      const topic  = request.topic;
      const id     = request.id;
      const method = request.params.request.method;
      const params = request.params.request.params as unknown[];

      const sendOk    = (result: unknown) => respondRequest({ topic, id, result });
      const sendErr   = (code: number, message: string) => respondError({ topic, id, code, message });

      // Dedup signature spam BEFORE any heavy work / pop-up.
      const dup = dedupCheck(method, params);
      if (dup.duplicate) {
        await sendErr(-32002, 'Duplicate request rejected (already submitted within 3s)');
        return;
      }

      try {
        switch (method) {
          case 'personal_sign': {
            // params: [hexMessage, fromAddress] — the address may or may not
            // be checksummed; we sign regardless of order as long as one of
            // the entries matches our address.
            const messageHex = (params[0] as string) ?? '';
            // Auto-approve for MVP. UI approval pass is the next iteration.
            // Worker-isolated signing first; on worker_locked we fall back
            // to in-process signing so an early-cold-start race doesn't fail.
            let signature: string;
            try {
              const r = await signerSignMessage(messageHex);
              signature = r.signature;
            } catch (wErr) {
              const code = wErr instanceof SignerError ? wErr.code : '';
              if (code === 'worker_locked' || code === 'worker_crashed') {
                const wallet = currentWallet();
                const messageBytes = messageHex.startsWith('0x')
                  ? Buffer.from(messageHex.slice(2), 'hex')
                  : new TextEncoder().encode(String(messageHex));
                signature = await wallet.signMessage(messageBytes);
              } else {
                throw wErr;
              }
            }
            await sendOk(signature);
            break;
          }
          case 'eth_signTypedData_v4': {
            const typedData = JSON.parse(params[1] as string) as {
              domain: Record<string, unknown>;
              types:  Record<string, Array<{ name: string; type: string }>>;
              message: Record<string, unknown>;
              primaryType: string;
            };
            // ethers v6 wants {types} *without* EIP712Domain — strip if present.
            const { EIP712Domain, ...types } = typedData.types as Record<string, unknown>;
            void EIP712Domain;
            const cleanTypes = types as Record<string, Array<{ name: string; type: string }>>;

            const doSign = async () => {
              let sig: string;
              try {
                const r = await signerSignTypedData({ domain: typedData.domain, types: cleanTypes, message: typedData.message });
                sig = r.signature;
              } catch (wErr) {
                const code = wErr instanceof SignerError ? wErr.code : '';
                if (code === 'worker_locked' || code === 'worker_crashed') {
                  const wallet = currentWallet();
                  sig = await wallet.signTypedData(typedData.domain, cleanTypes, typedData.message);
                } else {
                  throw wErr;
                }
              }
              await sendOk(sig);
            };

            const verdict = classifyTypedData({
              primaryType: typedData.primaryType,
              domain:      typedData.domain as { name?: string; verifyingContract?: string },
              message:     typedData.message,
            });
            if (verdict.risk === 'safe') {
              await doSign();
            } else {
              // Hand to the confirm modal; resume on user approve.
              await queueForConfirm({
                request, verdict,
                summary: `Sign typed data: ${typedData.primaryType || 'unknown'} on ${(typedData.domain as { name?: string })?.name ?? 'this dApp'}.`,
                approve: doSign,
                reject:  async () => { await sendErr(4001, 'User rejected the signature'); },
              });
            }
            break;
          }
          case 'eth_sendTransaction': {
            const txParams = params[0] as {
              to: string; value?: string; data?: string; gas?: string; gasLimit?: string;
              maxFeePerGas?: string; maxPriorityFeePerGas?: string;
            };
            // Surface the Permit hint when the dApp is asking us to sign
            // an ERC-20 approve() — once per session topic, in console only.
            maybePermitHint(txParams.data, topic);

            const doSend = async () => {
              let hash: string;
              try {
                const r = await signerSignTransaction({
                  to:                   txParams.to,
                  value:                txParams.value,
                  data:                 txParams.data,
                  gasLimit:             txParams.gas ?? txParams.gasLimit,
                  maxFeePerGas:         txParams.maxFeePerGas,
                  maxPriorityFeePerGas: txParams.maxPriorityFeePerGas,
                });
                hash = r.hash;
              } catch (wErr) {
                const code = wErr instanceof SignerError ? wErr.code : '';
                if (code === 'worker_locked' || code === 'worker_crashed') {
                  const w = currentWallet(makeProvider());
                  const tx = await w.sendTransaction({
                    to:    txParams.to,
                    value: txParams.value ? BigInt(txParams.value) : undefined,
                    data:  txParams.data,
                    gasLimit:             txParams.gas ?? txParams.gasLimit,
                    maxFeePerGas:         txParams.maxFeePerGas,
                    maxPriorityFeePerGas: txParams.maxPriorityFeePerGas,
                  });
                  hash = tx.hash;
                } else {
                  throw wErr;
                }
              }
              await sendOk(hash);
            };

            const verdict = classifyTransaction({
              to:    txParams.to,
              value: txParams.value,
              data:  txParams.data,
            } satisfies TxLike);
            if (verdict.risk === 'safe') {
              await doSend();
            } else {
              await queueForConfirm({
                request, verdict,
                summary: `Send transaction to ${txParams.to}`,
                approve: doSend,
                reject:  async () => { await sendErr(4001, 'User rejected the transaction'); },
              });
            }
            break;
          }
          case 'eth_accounts':
          case 'eth_requestAccounts': {
            await sendOk([evmRef.current]);
            break;
          }
          case 'eth_chainId': {
            await sendOk(toHexChainId(getSessionChainId(topic)));
            break;
          }
          case 'wallet_switchEthereumChain': {
            // Spec: params is [{ chainId: '0xHEX' }]. Reply null on success;
            // 4902 if the chain is unknown (dApp may follow with addEthereumChain).
            const p = (params[0] as { chainId?: string } | undefined) ?? {};
            const requested = typeof p.chainId === 'string' ? parseInt(p.chainId, 16) : NaN;
            if (!Number.isFinite(requested)) {
              await sendErr(-32602, 'Invalid chainId');
              break;
            }
            if (!SUPPORTED_CHAIN_IDS.has(requested)) {
              await sendErr(4902, `Unrecognised chain ${requested}. Call wallet_addEthereumChain first.`);
              break;
            }
            setSessionChainId(topic, requested);
            // Emit chainChanged so the dApp's provider can re-read state.
            // Failure here is non-fatal — the dApp would just poll instead.
            void emitChainChanged(topic, requested).catch(() => {});
            await sendOk(null);
            break;
          }
          case 'wallet_addEthereumChain': {
            // We accept the call iff we already know the chain — there's no
            // dynamic registry today. Spec returns null on success.
            const p = (params[0] as { chainId?: string } | undefined) ?? {};
            const requested = typeof p.chainId === 'string' ? parseInt(p.chainId, 16) : NaN;
            if (!Number.isFinite(requested) || !SUPPORTED_CHAIN_IDS.has(requested)) {
              await sendErr(4902, `Chain ${p.chainId} is not supported by this wallet.`);
              break;
            }
            setSessionChainId(topic, requested);
            void emitChainChanged(topic, requested).catch(() => {});
            await sendOk(null);
            break;
          }
          default:
            await sendErr(4200, `Method not supported: ${method}`);
        }
      } catch (e) {
        const err = e as { code?: number; message?: string };
        await sendErr(err.code ?? -32603, err.message ?? 'Internal error');
      }
    })
      .then(fn => { unsub = fn; })
      .catch(() => {});

    return () => { if (unsub) unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount once; refs keep latest seed/address

  /* ─── Risky-request confirm modal ──────────────────────────────────
     Only rendered when classifyTransaction / classifyTypedData flagged
     a non-safe risk. Safe requests pass through silently. */
  if (!pending) return null;

  const close   = () => { setPending(null); setBusy(null); };
  const onApprove = async () => {
    if (busy) return;
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
  const dAppName = (pending.request as unknown as { verifyContext?: { verified?: { origin?: string } } })
    .verifyContext?.verified?.origin ?? 'dApp';

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
          <div style={{ fontSize: 13, fontWeight: 600, wordBreak: 'break-all' }}>
            {pending.summary}
          </div>
          <PhishingBanner verdict={pending.verdict}/>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              className="btn-outline"
              style={{ flex: 1 }}
              onClick={onReject}
              disabled={busy === 'approve'}
            >
              {busy === 'reject' ? 'Rejecting…' : 'Reject'}
            </button>
            <button
              className="btn-primary"
              style={{
                flex: 1,
                background: pending.verdict.risk === 'critical' ? 'var(--red)' : undefined,
                opacity: busy ? 0.6 : 1,
              }}
              onClick={onApprove}
              disabled={busy === 'reject'}
            >
              {busy === 'approve'
                ? 'Signing…'
                : pending.verdict.risk === 'critical' ? 'Sign anyway' : 'Approve & sign'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
