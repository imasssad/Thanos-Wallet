'use client';
import React, { useState, useMemo, useEffect } from 'react';
import { TOKENS } from '../lib/tokens';
import { useWallet } from './shell/AppShell';
import {
  validateAddressForChain, resolveToEvm, truncateLithoAddress,
  MAKALU_CHAIN_ID,
} from '../lib/address';
import { sendTokens, estimateSendFee, SendError, makeProvider } from '../lib/signer';
import { signerSend, SignerError } from '../lib/signer-client';
import {
  getQuote   as multxGetQuote,
  execute    as multxExecute,
  getStatus  as multxGetStatus,
  type Quote as MultXQuote,
  MultXUnavailable,
} from '../lib/multx';
import { TokenSelect } from './ui/TokenSelect';
import { QrScannerModal } from './QrScannerModal';
import { searchContacts, findContactByAddress, type Contact } from '../lib/address-book';
import { looksLikeName, resolveName } from '../lib/dnns';
import { QrCode } from 'lucide-react';

const TOKEN_SYMBOLS = TOKENS.map(t => t.sym);
const BAL_MAP: Record<string, string> = Object.fromEntries(TOKENS.map(t => [t.sym, t.balance]));

export type ModalKind = 'send' | 'receive' | 'swap' | null;

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

type SendStage = 'compose' | 'broadcasting' | 'pending' | 'confirmed' | 'failed';

export function SendModal({ onClose }: { onClose: () => void }) {
  const wallet = useWallet();
  const [coin, setCoin]     = useState('LITHO');
  const [to, setTo]         = useState('');
  const [amount, setAmount] = useState('');

  const [stage, setStage]   = useState<SendStage>('compose');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [feeStr, setFeeStr] = useState<string | null>(null);

  // Recipient UX state — QR scanner + address-book autocomplete + DNNS resolver.
  const [showQr,       setShowQr]       = useState(false);
  const [showSuggest,  setShowSuggest]  = useState(false);
  const [dnnsResolved, setDnnsResolved] = useState<string | null>(null);
  const [dnnsState,    setDnnsState]    = useState<'idle' | 'resolving' | 'not-found'>('idle');
  const contactSuggestions = useMemo<Contact[]>(() => {
    const trimmed = to.trim();
    if (!trimmed) return [];
    return searchContacts(trimmed).slice(0, 5);
  }, [to]);
  const matchedContact = useMemo<Contact | null>(() => {
    // If the input already matches a saved contact, show their name beside the
    // green "Valid address" badge.
    return canonicalEvmFor(to);
  }, [to]);

  function canonicalEvmFor(input: string): Contact | null {
    const evm = resolveToEvm(input.trim());
    return evm ? findContactByAddress(evm) : null;
  }

  const balMap = BAL_MAP;

  /* Validate the recipient against the chain. For LITHO / wLITHO / FGPT
     etc. on Makalu, accept litho1… or 0x…; for anything else, EVM only. */
  const recipientValidation = useMemo(() => {
    const trimmed = to.trim();
    if (!trimmed) return { valid: false, format: null as 'evm' | 'litho' | null, reason: '' };
    return validateAddressForChain(trimmed, MAKALU_CHAIN_ID);
  }, [to]);

  /* Canonical EVM form — what we'd actually broadcast to the chain.
     If the user typed a DNNS name and we resolved it, use that instead. */
  const canonicalEvm = useMemo(() => {
    const direct = resolveToEvm(to.trim());
    if (direct) return direct;
    return dnnsResolved;
  }, [to, dnnsResolved]);

  /* Debounced DNNS resolution. Only fires when the input looks like a
     name (contains '.', not a raw address). Sets state to drive the inline
     "Resolved to 0x…" hint. */
  useEffect(() => {
    const trimmed = to.trim();
    if (!looksLikeName(trimmed)) {
      setDnnsResolved(null);
      setDnnsState('idle');
      return;
    }
    let cancelled = false;
    setDnnsState('resolving');
    const t = setTimeout(async () => {
      const addr = await resolveName(trimmed);
      if (cancelled) return;
      setDnnsResolved(addr);
      setDnnsState(addr ? 'idle' : 'not-found');
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [to]);

  /* Live fee estimate. Re-runs (debounced) when the inputs change. Read-only,
     never broadcasts — safe to call repeatedly. */
  useEffect(() => {
    if (!wallet?.seed?.length || !recipientValidation.valid || !amount) {
      setFeeStr(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const est = await estimateSendFee(
          wallet.privateKey ? { privateKey: wallet.privateKey } : { seed: wallet.seed },
          { symbol: coin, recipient: to, amount },
        );
        if (!cancelled) setFeeStr(est ? `${Number(est.totalLitho).toFixed(6)} LITHO` : null);
      } catch {
        if (!cancelled) setFeeStr(null);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [coin, to, amount, recipientValidation.valid, wallet?.seed]);

  const onSubmit = async () => {
    if (!wallet?.seed?.length) {
      setError('Wallet is locked. Please refresh and unlock.');
      setStage('failed');
      return;
    }
    setStage('broadcasting');
    setError(null);
    try {
      // Prefer the worker-isolated signing path. The worker holds the
      // secret in its own context; the main thread only sees the tx hash
      // come back. If the worker is unavailable (race condition during
      // init, or unsupported browser) we fall back to in-process signing.
      let hash: string;
      try {
        const result = await signerSend({ symbol: coin, recipient: to, amount });
        hash = result.hash;
      } catch (workerErr) {
        const code = workerErr instanceof SignerError ? workerErr.code : '';
        if (code === 'worker_locked' || code === 'worker_crashed') {
          const fallback = await sendTokens(
            wallet.privateKey ? { privateKey: wallet.privateKey } : { seed: wallet.seed },
            { symbol: coin, recipient: to, amount },
          );
          hash = fallback.hash;
          // Background: legacy path exposes a wait() for confirmation polling.
          fallback.wait()
            .then(r => {
              setStage(r.status === 1 ? 'confirmed' : 'failed');
              if (r.status !== 1) setError('Transaction reverted on-chain');
            })
            .catch(() => setStage('failed'));
        } else {
          // Bubble typed worker errors through the same SendError shape so
          // the existing 'failed' UI surfaces a clean message.
          throw workerErr;
        }
      }
      setTxHash(hash);
      setStage('pending');
      // Worker path: poll the chain for confirmation via the main-thread
      // provider. Doesn't block the UI; user can dismiss the modal.
      if (!error && hash) {
        makeProvider().waitForTransaction(hash)
          .then(r => {
            if (!r) { setStage('failed'); return; }
            setStage(Number(r.status) === 1 ? 'confirmed' : 'failed');
            if (Number(r.status) !== 1) setError('Transaction reverted on-chain');
          })
          .catch(() => setStage('failed'));
      }
    } catch (e) {
      const msg = e instanceof SendError ? e.message
               : e instanceof SignerError ? e.message
               : (e as Error).message || 'Failed to send';
      setError(msg);
      setStage('failed');
    }
  };

  /* ─── Result states (broadcast / pending / confirmed / failed) ───── */

  if (stage !== 'compose') {
    const explorer = txHash ? `https://makalu.litho.ai/tx/${txHash}` : null;
    return (
      <Modal title="Send" onClose={onClose}>
        <div className="modal-success">
          {stage === 'broadcasting' && <>
            <div className="success-icon" style={{ animation: 'lpScrollHint 1.4s ease-in-out infinite' }}>…</div>
            <div className="success-title">Signing &amp; broadcasting</div>
            <div className="success-sub">Sending {amount} {coin} to {truncateLithoAddress(to.trim(), 10, 6)}</div>
          </>}
          {stage === 'pending' && <>
            <div className="success-icon">✓</div>
            <div className="success-title">Submitted</div>
            <div className="success-sub">Waiting for confirmation…</div>
            {txHash && <a href={explorer ?? '#'} target="_blank" rel="noreferrer"
              style={{ fontSize: 11, color: 'var(--blue)', wordBreak: 'break-all', fontFamily: 'Geist Mono, monospace', marginTop: 6 }}>
              {truncateLithoAddress(txHash, 14, 10)}
            </a>}
            <button className="btn-primary" onClick={onClose} style={{ marginTop: 12 }}>Done</button>
          </>}
          {stage === 'confirmed' && <>
            <div className="success-icon" style={{ color: 'var(--green)' }}>✓</div>
            <div className="success-title">Confirmed</div>
            <div className="success-sub">{amount} {coin} sent to {truncateLithoAddress(to.trim(), 10, 6)}</div>
            {txHash && <a href={explorer ?? '#'} target="_blank" rel="noreferrer"
              style={{ fontSize: 11, color: 'var(--blue)', wordBreak: 'break-all', fontFamily: 'Geist Mono, monospace', marginTop: 6 }}>
              View on explorer →
            </a>}
            <button className="btn-primary" onClick={onClose} style={{ marginTop: 12 }}>Done</button>
          </>}
          {stage === 'failed' && <>
            <div className="success-icon" style={{ color: 'var(--red)' }}>✕</div>
            <div className="success-title">Transaction failed</div>
            <div className="success-sub" style={{ color: 'var(--red)' }}>{error || 'Unknown error'}</div>
            <button className="btn-primary" onClick={() => { setStage('compose'); setError(null); setTxHash(null); }}
              style={{ marginTop: 12 }}>Try again</button>
          </>}
        </div>
      </Modal>
    );
  }

  /* ─── Compose state ──────────────────────────────────────────────── */

  return (
    <Modal title="Send" onClose={onClose}>
      <div className="modal-body">
        <label className="field-label">Asset</label>
        <TokenSelect value={coin} onChange={setCoin} options={TOKEN_SYMBOLS} ariaLabel="Send asset"/>

        <label className="field-label" style={{ marginTop: 14 }}>Recipient address</label>
        <div style={{ position: 'relative' }}>
          <input
            className="field-input"
            placeholder="litho1… or 0x…"
            value={to}
            onChange={e => { setTo(e.target.value); setShowSuggest(true); }}
            onFocus={() => setShowSuggest(true)}
            onBlur={() => setTimeout(() => setShowSuggest(false), 120)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            style={{ fontFamily: to ? 'Geist Mono, monospace' : undefined, fontSize: to ? 12 : undefined, paddingRight: 40 }}
          />
          <button
            type="button"
            onClick={() => setShowQr(true)}
            aria-label="Scan QR"
            title="Scan QR"
            style={{
              position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
              borderRadius: 6, padding: 4, cursor: 'pointer', display: 'flex',
            }}
          >
            <QrCode size={16} color="var(--text-secondary)"/>
          </button>
        </div>

        {/* Saved-contact autocomplete — shows up to 5 matches as the user types. */}
        {showSuggest && contactSuggestions.length > 0 && (
          <div style={{
            marginTop: 6,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 8,
            padding: 4,
            maxHeight: 180,
            overflowY: 'auto',
          }}>
            {contactSuggestions.map(c => (
              <button
                key={c.id}
                type="button"
                onMouseDown={() => { setTo(c.evm); setShowSuggest(false); }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  width: '100%', padding: '8px 10px', borderRadius: 6,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'inherit', textAlign: 'left',
                }}
                onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseOut={e  => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ fontSize: 12, fontWeight: 600 }}>{c.name}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace' }}>{c.evm}</span>
              </button>
            ))}
          </div>
        )}

        {to.trim() && recipientValidation.valid && (
          <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            ✓ Valid {recipientValidation.format === 'litho' ? 'litho1' : 'EVM'} address
            {matchedContact && (
              <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>· {matchedContact.name}</span>
            )}
            {recipientValidation.format === 'litho' && canonicalEvm && (
              <span style={{ color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace' }}>
                · {truncateLithoAddress(canonicalEvm, 8, 6)}
              </span>
            )}
          </div>
        )}

        {/* DNNS — resolved / resolving / not-found states for name input. */}
        {looksLikeName(to.trim()) && (
          <>
            {dnnsState === 'resolving' && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Resolving {to.trim()}…
              </div>
            )}
            {dnnsState === 'idle' && dnnsResolved && (
              <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                ✓ Resolved {to.trim()}
                <span style={{ color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace' }}>
                  → {truncateLithoAddress(dnnsResolved, 8, 6)}
                </span>
              </div>
            )}
            {dnnsState === 'not-found' && (
              <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>
                Could not resolve {to.trim()}
              </div>
            )}
          </>
        )}

        {to.trim() && !recipientValidation.valid && !looksLikeName(to.trim()) && (
          <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>
            {recipientValidation.reason || 'Invalid address'}
          </div>
        )}

        <QrScannerModal
          open={showQr}
          onClose={() => setShowQr(false)}
          onResult={(decoded) => { setTo(decoded); setShowQr(false); }}
        />


        <label className="field-label" style={{ marginTop: 14 }}>Amount</label>
        <div style={{ position: 'relative' }}>
          <input className="field-input" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} type="number" style={{ paddingRight: 60 }}/>
          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{coin}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Balance: {balMap[coin] ?? '—'} {coin}
          <button style={{ background: 'none', border: 'none', color: 'var(--blue)', fontSize: 11, cursor: 'pointer', marginLeft: 8, fontWeight: 600 }} onClick={() => setAmount(balMap[coin] ?? '')}>MAX</button>
        </div>
        <div className="fee-row"><span>Network fee</span><span>{feeStr ? `≈ ${feeStr}` : '—'}</span></div>
        <button
          className="btn-primary"
          style={{ marginTop: 18 }}
          disabled={!recipientValidation.valid || !amount || !wallet?.seed?.length}
          onClick={onSubmit}
        >
          Send {coin}
        </button>
        {!wallet?.seed?.length && (
          <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 6, textAlign: 'center' }}>
            Wallet locked — refresh to unlock
          </div>
        )}
      </div>
    </Modal>
  );
}

export function ReceiveModal({ onClose }: { onClose: () => void }) {
  const wallet = useWallet();
  const [fmt, setFmt] = useState<'litho' | 'evm'>('litho');
  const [copied, setCopied] = useState(false);

  // Fallback used only if the gate hasn't resolved (defensive — shouldn't happen).
  const litho = wallet?.addresses?.litho ?? '';
  const evm   = wallet?.addresses?.evm   ?? '';
  const activeAddr = fmt === 'litho' ? litho : evm;

  const copy = () => {
    if (!activeAddr) return;
    navigator.clipboard?.writeText(activeAddr).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Modal title="Receive" onClose={onClose}>
      <div className="modal-body" style={{ alignItems: 'center', textAlign: 'center' }}>
        {/* Format toggle */}
        <div className="addr-fmt-toggle" role="tablist">
          <button
            className={`addr-fmt-pill ${fmt === 'litho' ? 'active' : ''}`}
            onClick={() => setFmt('litho')}
            role="tab"
          >
            litho1…
          </button>
          <button
            className={`addr-fmt-pill ${fmt === 'evm' ? 'active' : ''}`}
            onClick={() => setFmt('evm')}
            role="tab"
          >
            EVM 0x…
          </button>
        </div>

        <div className="qr-box" aria-label={`QR for ${activeAddr}`}>
          {/* Placeholder QR — replaced by a real qrcode-generated SVG in the
              follow-up commit that wires receive end-to-end. */}
          <svg viewBox="0 0 100 100" width="140" height="140">
            <rect x="5" y="5" width="38" height="38" rx="4" fill="none" stroke="currentColor" strokeWidth="3"/>
            <rect x="14" y="14" width="20" height="20" rx="2" fill="currentColor"/>
            <rect x="57" y="5" width="38" height="38" rx="4" fill="none" stroke="currentColor" strokeWidth="3"/>
            <rect x="66" y="14" width="20" height="20" rx="2" fill="currentColor"/>
            <rect x="5" y="57" width="38" height="38" rx="4" fill="none" stroke="currentColor" strokeWidth="3"/>
            <rect x="14" y="66" width="20" height="20" rx="2" fill="currentColor"/>
            {[57,63,69,75,81,87,93].map((x,i) =>
              [57,63,69,75,81,87,93].map((y,j) =>
                (i+j)%2===0 ? <rect key={`${i}${j}`} x={x} y={y} width="4" height="4" fill="currentColor" opacity="0.7"/> : null
              )
            )}
          </svg>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
          {fmt === 'litho' ? 'Lithosphere bech32 address' : 'EVM hex address'}
        </div>
        <div className="addr-box" title={activeAddr}>
          {activeAddr ? truncateLithoAddress(activeAddr, 14, 8) : '—'}
        </div>
        <button className="btn-primary" onClick={copy} style={{ marginTop: 14, width: '100%' }} disabled={!activeAddr}>
          {copied ? '✓ Copied!' : 'Copy address'}
        </button>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.6 }}>
          Both forms resolve to the same account. Only send assets on supported networks.
        </div>
      </div>
    </Modal>
  );
}

type SwapStage = 'compose' | 'executing' | 'bridging' | 'settling' | 'completed' | 'failed';

export function SwapModal({ onClose }: { onClose: () => void }) {
  const [from, setFrom] = useState('LITHO');
  const [to, setTo]     = useState('LitBTC');
  const [amt, setAmt]   = useState('100');

  /** Live MultX quote (or null while loading / unavailable). */
  const [quote, setQuote]               = useState<MultXQuote | null>(null);
  const [quoteError, setQuoteError]     = useState<string | null>(null);
  const [bridgeOffline, setBridgeOffline] = useState(false);

  /* Execution / status tracking — once the user clicks Swap, we POST to
     /v1/execute, then poll /v1/status/:id until the bridge resolves the
     destination tx (or errors). State transitions drive a simple progress
     panel beneath the form. */
  const [stage, setStage] = useState<SwapStage>('compose');
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [sourceHash,  setSourceHash]  = useState<string | null>(null);
  const [destHash,    setDestHash]    = useState<string | null>(null);
  const [execError,   setExecError]   = useState<string | null>(null);

  // Fallback indicative rate from the canonical USD prices — used only when
  // the MultX endpoint isn't reachable, so the UI still has something to show.
  const priceOf = (sym: string) => TOKENS.find(t => t.sym === sym)?.priceUsd ?? 1;
  const fallbackRate = priceOf(from) / priceOf(to);
  const fallbackOut  = fallbackRate * parseFloat(amt || '0');

  /* Debounced quote fetch. Cancels in-flight fetches when the inputs change. */
  useEffect(() => {
    const trimmed = amt.trim();
    if (!trimmed || parseFloat(trimmed) <= 0 || from === to) {
      setQuote(null); setQuoteError(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const q = await multxGetQuote(from, to, trimmed);
        if (!cancelled) {
          setQuote(q); setQuoteError(null); setBridgeOffline(false);
        }
      } catch (e) {
        if (!cancelled) {
          setQuote(null);
          if (e instanceof MultXUnavailable) {
            setBridgeOffline(true);
            setQuoteError('Bridge offline — showing indicative rate');
          } else {
            setQuoteError((e as Error).message || 'Quote failed');
          }
        }
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [from, to, amt]);

  const displayedRate = quote ? quote.rate : fallbackRate;
  const displayedOut  = quote ? Number(quote.toAmount) : fallbackOut;
  const feeLine = quote ? `${quote.feeFrom} ${quote.from}` : 'Rate-only preview';

  /* Poll /v1/status/:id while we're in an in-flight state. The bridge SLA
     is "minutes, not seconds" so 4s polling is plenty. On terminal states
     we stop the loop and surface the result. */
  useEffect(() => {
    if (!executionId) return;
    if (stage === 'completed' || stage === 'failed') return;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await multxGetStatus(executionId);
        if (cancelled) return;
        if (s.sourceHash) setSourceHash(s.sourceHash);
        if (s.destHash)   setDestHash(s.destHash);
        if (s.state === 'completed') setStage('completed');
        else if (s.state === 'failed') { setStage('failed'); setExecError(s.error || 'Bridge reported failure'); }
        else if (s.state === 'settling')  setStage('settling');
        else if (s.state === 'bridging')  setStage('bridging');
      } catch {
        /* Don't flip to failed on a single network blip — the bridge could
           be temporarily slow. The user can close the modal if they want. */
      }
    };
    tick();
    const id = setInterval(tick, 4_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [executionId, stage]);

  /* Kick off the bridge execution. The real signedTx envelope is something
     the bridge contract spec defines (not yet finalised), so today we send
     an empty placeholder — the bridge will accept-or-reject and we surface
     either path through the polling effect above. Once the spec lands the
     signedTx construction goes here. */
  const onSwap = async () => {
    if (!quote) return;
    setStage('executing');
    setExecError(null);
    try {
      const exec = await multxExecute(quote.quoteId, /* signedTx */ '0x');
      setExecutionId(exec.executionId);
      setSourceHash(exec.sourceHash ?? null);
      setStage(exec.state === 'pending' ? 'bridging' : exec.state);
    } catch (e) {
      setStage('failed');
      setExecError(e instanceof MultXUnavailable
        ? 'Bridge is unavailable — try again in a moment.'
        : (e as Error).message || 'Bridge execute failed');
    }
  };

  /* ─── Status panel ─── */
  if (stage !== 'compose') {
    return (
      <Modal title="Swap" onClose={onClose}>
        <div className="modal-body" style={{ padding: '8px 0' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '12px 0' }}>
            {stage === 'completed' ? (
              <div style={{ fontSize: 28, color: 'var(--green)' }}>✓</div>
            ) : stage === 'failed' ? (
              <div style={{ fontSize: 28, color: 'var(--red)' }}>✕</div>
            ) : (
              <div style={{ width: 36, height: 36, border: '3px solid var(--border-default)', borderTopColor: 'var(--blue)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}/>
            )}
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              {stage === 'executing' && 'Submitting to bridge…'}
              {stage === 'bridging'  && 'Bridging — moving funds across chains'}
              {stage === 'settling'  && 'Settling on destination chain'}
              {stage === 'completed' && 'Swap complete'}
              {stage === 'failed'    && 'Swap failed'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 280 }}>
              {amt} {from} → {displayedOut.toFixed(6)} {to}
            </div>
            {sourceHash && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace', wordBreak: 'break-all', maxWidth: 320 }}>
                Source: <a href={`https://makalu.litho.ai/tx/${sourceHash}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)' }}>{sourceHash}</a>
              </div>
            )}
            {destHash && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace', wordBreak: 'break-all', maxWidth: 320 }}>
                Destination: <code>{destHash}</code>
              </div>
            )}
            {execError && (
              <div style={{ fontSize: 11, color: 'var(--red)', textAlign: 'center', maxWidth: 320 }}>{execError}</div>
            )}
          </div>
          {(stage === 'completed' || stage === 'failed') && (
            <button className="btn-primary" onClick={onClose} style={{ marginTop: 8 }}>Done</button>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Swap" onClose={onClose}>
      <div className="modal-body">
        <label className="field-label">From</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: '0 0 130px' }}>
            <TokenSelect value={from} onChange={setFrom} options={TOKEN_SYMBOLS} ariaLabel="Swap from"/>
          </div>
          <input className="field-input" value={amt} onChange={e => setAmt(e.target.value)} type="number" placeholder="0.00" style={{ flex: 1 }}/>
        </div>
        <div style={{ textAlign: 'center', margin: '10px 0' }}>
          <button className="swap-btn" onClick={() => { setFrom(to); setTo(from); }}>⇅</button>
        </div>
        <label className="field-label">To</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: '0 0 130px' }}>
            <TokenSelect value={to} onChange={setTo} options={TOKEN_SYMBOLS} ariaLabel="Swap to"/>
          </div>
          <div className="field-input" style={{ flex: 1, display: 'flex', alignItems: 'center', color: 'var(--text-primary)', fontWeight: 700, fontSize: 18 }}>
            {isFinite(displayedOut) ? displayedOut.toFixed(6) : '—'}
          </div>
        </div>
        <div className="fee-row" style={{ marginTop: 14 }}>
          <span>Rate</span>
          <span>1 {from} ≈ {displayedRate.toLocaleString('en-US', { maximumFractionDigits: 6 })} {to}</span>
        </div>
        <div className="fee-row">
          <span>Bridge fee</span>
          <span>{feeLine}</span>
        </div>
        {(quoteError || bridgeOffline) && (
          <div style={{ fontSize: 11, color: bridgeOffline ? 'var(--text-muted)' : 'var(--red)', marginTop: 6 }}>
            {bridgeOffline ? '⚠ ' : ''}{quoteError}
          </div>
        )}
        <button
          className="btn-primary"
          style={{ marginTop: 18 }}
          disabled={!quote || bridgeOffline}
          onClick={onSwap}
          title={bridgeOffline ? 'Bridge offline — cannot execute' : ''}
        >
          {quote ? `Swap ${from} → ${to}` : (bridgeOffline ? 'Bridge offline' : 'Fetching quote…')}
        </button>
      </div>
    </Modal>
  );
}
