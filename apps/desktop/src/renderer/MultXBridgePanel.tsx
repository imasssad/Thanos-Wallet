/* MultX bridge — every route the signed release manifest approves. Lock on
 * the source chain → validators sign → the relayer releases to the same
 * address on the destination chain; it shows as arrived only once the
 * release is verified there. Rendered only when the build enables MultX
 * (multx-thanos.ts). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  bridgeErrorMessage, bridgeTransferLabel, formatBridgeAmount, parseBridgeAmount,
  type MultXBridgeOption, type MultXBridgeStep, type MultXBridgeTransfer,
} from '@thanos/sdk-core';
import { Wallet } from 'ethers';
import { thanosBridge, multxChain, multxSigner, multxPrivateKey } from './multx-thanos';

const TONE: Record<'pending' | 'ok' | 'bad' | 'warn', string> = {
  pending: 'var(--blue, #3b7af7)', ok: 'var(--green, #10b981)', bad: 'var(--red)', warn: 'var(--yellow, #eab308)',
};

function stepText(step: MultXBridgeStep, o: MultXBridgeOption): string {
  const from = multxChain(o.sourceChainId).name;
  switch (step) {
    case 'checking':  return 'Checking balance…';
    case 'approving': return `Approving ${o.symbol}…`;
    case 'locking':   return `Locking ${o.symbol} on ${from}…`;
    case 'bridging':  return 'Validators signing — this can take a few minutes…';
  }
}

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

function TxLink({ chainId, hash, label }: { chainId: number; hash?: string; label: string }) {
  if (!hash) return null;
  const href = multxChain(chainId).explorerTx?.(hash);
  return (
    <div className="fee-row" style={{ marginTop: 6 }}>
      <span>{label}</span>
      {href
        ? <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue, #3b7af7)', fontFamily: 'monospace', fontSize: 12 }}>{short(hash)}</a>
        : <code style={{ fontSize: 12 }}>{short(hash)}</code>}
    </div>
  );
}

export function MultXBridgePanel({ seed }: { seed: string[] }) {
  const address = useMemo(() => { try { return seed.length ? new Wallet(multxPrivateKey(seed)).address : ''; } catch { return ''; } }, [seed]);
  const canSign = !!address;
  const bridge = thanosBridge();

  const [options, setOptions] = useState<MultXBridgeOption[] | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [src, setSrc] = useState<number | null>(null);
  const [dst, setDst] = useState<number | null>(null);
  const [sym, setSym] = useState('');
  const [amt, setAmt] = useState('');
  const [balance, setBalance] = useState<bigint | null>(null);
  const [step, setStep] = useState<MultXBridgeStep | null>(null);
  const [current, setCurrent] = useState<MultXBridgeTransfer | null>(null);
  const [err, setErr] = useState('');
  const [history, setHistory] = useState<MultXBridgeTransfer[]>([]);
  const running = useRef(false);

  const refreshHistory = useCallback(() => {
    if (address) void bridge.history(address).then(setHistory);
  }, [bridge, address]);

  const load = useCallback(() => {
    setLoadErr(''); setOptions(null);
    bridge.load({ refresh: true }).then((list) => {
      setOptions(list);
      if (address) void bridge.resumePending(address, refreshHistory);
    }).catch((e) => setLoadErr(bridgeErrorMessage(e)));
  }, [bridge, address, refreshHistory]);

  useEffect(() => { load(); refreshHistory(); }, [load, refreshHistory]);

  const sources = useMemo(() => [...new Set((options ?? []).map((o) => o.sourceChainId))], [options]);
  const dests = useMemo(() => [...new Set((options ?? []).filter((o) => o.sourceChainId === src).map((o) => o.destinationChainId))], [options, src]);
  const tokens = useMemo(() => (options ?? []).filter((o) => o.sourceChainId === src && o.destinationChainId === dst), [options, src, dst]);
  const option = tokens.find((o) => o.symbol === sym) ?? null;

  // Keep the pickers on something that exists as the lists change.
  useEffect(() => { if (sources.length && (src === null || !sources.includes(src))) setSrc(sources[0]); }, [sources, src]);
  useEffect(() => { if (dests.length && (dst === null || !dests.includes(dst))) setDst(dests[0]); }, [dests, dst]);
  useEffect(() => { if (tokens.length && !tokens.some((o) => o.symbol === sym)) setSym(tokens[0].symbol); }, [tokens, sym]);

  useEffect(() => {
    setBalance(null);
    if (!option || !address) return;
    let live = true;
    bridge.balanceOf(option, address).then((b) => { if (live) setBalance(b); }).catch(() => {});
    return () => { live = false; };
  }, [bridge, option, address, current?.status]);

  const busy = step !== null;
  let amountErr = '';
  let base: bigint | null = null;
  if (option && amt.trim()) {
    try {
      base = parseBridgeAmount(amt, option);
      if (balance !== null && base > balance) amountErr = `More than your ${option.symbol} balance.`;
    } catch (e) { amountErr = bridgeErrorMessage(e); }
  }
  const canRun = !!option && canSign && !!base && !amountErr && !busy;

  async function run() {
    if (!option || !canRun || running.current) return;
    running.current = true;
    setErr(''); setCurrent(null); setStep('checking');
    let signer: ReturnType<typeof multxSigner> | null = null;
    try {
      signer = multxSigner(seed, option.sourceChainId);
      const done = await bridge.send({
        signer: signer.signer, option, amount: amt,
        onStep: setStep,
        onUpdate: (t) => { setCurrent(t); refreshHistory(); },
      });
      setCurrent(done);
      const amount = `${formatBridgeAmount(done.amountBaseUnits, done.decimals)} ${done.symbol}`;
      if (done.status === 'RELEASED') {
        setAmt('');
        void window.thanosDesktop?.notify?.('Bridge complete', `${amount} arrived on ${multxChain(done.destinationChainId).name}.`);
      } else if (done.status === 'REVIEW') {
        void window.thanosDesktop?.notify?.('Bridge — release not confirmed yet', `${amount} sent; Thanos keeps checking the release.`);
      }
    } catch (e) {
      setErr(bridgeErrorMessage(e));
      void window.thanosDesktop?.notify?.('Bridge failed', bridgeErrorMessage(e));
    } finally {
      signer?.destroy();
      setStep(null);
      running.current = false;
      refreshHistory();
    }
  }

  if (loadErr) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5, padding: '18px 4px' }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Bridge unavailable</div>
        {loadErr}
        <div><button className="btn-secondary" style={{ marginTop: 12 }} onClick={load}>Try again</button></div>
      </div>
    );
  }
  if (!options) return <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '18px 4px' }}>Loading bridge routes…</div>;
  if (!options.length) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5, padding: '18px 4px' }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>No bridge routes are open</div>
        MultX transfers are paused right now. Try again later.
      </div>
    );
  }

  const release = bridge.release();
  const from = src !== null ? multxChain(src) : null;
  const to = dst !== null ? multxChain(dst) : null;
  const outcome = current && !busy ? bridgeTransferLabel(current) : null;

  return (
    <>
      <label className="field-label">From</label>
      <select className="field-select" aria-label="From network" value={src ?? ''} disabled={busy}
        onChange={(e) => setSrc(Number(e.target.value))} style={{ width: '100%', cursor: 'pointer' }}>
        {sources.map((id) => <option key={id} value={id}>{multxChain(id).name}</option>)}
      </select>

      <label className="field-label" style={{ marginTop: 12 }}>To</label>
      <select className="field-select" aria-label="To network" value={dst ?? ''} disabled={busy}
        onChange={(e) => setDst(Number(e.target.value))} style={{ width: '100%', cursor: 'pointer' }}>
        {dests.map((id) => <option key={id} value={id}>{multxChain(id).name}</option>)}
      </select>

      <label className="field-label" style={{ marginTop: 12 }}>Asset</label>
      <select className="field-select" aria-label="Bridge asset" value={sym} disabled={busy}
        onChange={(e) => setSym(e.target.value)} style={{ width: '100%', cursor: 'pointer' }}>
        {tokens.map((o) => <option key={o.key} value={o.symbol}>{o.symbol}</option>)}
      </select>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 12 }}>
        <label className="field-label" style={{ margin: 0 }}>Amount</label>
        {option && balance !== null && (
          <button type="button" disabled={busy} onClick={() => setAmt(formatBridgeAmount(balance, option.decimals))}
            style={{ background: 'none', border: 'none', color: 'var(--blue, #3b7af7)', fontSize: 11, cursor: 'pointer', padding: 0 }}>
            Balance {formatBridgeAmount(balance, option.decimals)} {option.symbol} · Max
          </button>
        )}
      </div>
      <input className="field-input" inputMode="decimal" value={amt} disabled={busy} aria-label="Amount"
        onChange={(e) => setAmt(e.target.value)} placeholder="0.00" style={{ width: '100%', marginTop: 6, borderColor: amountErr ? 'var(--red)' : undefined }}/>
      {amountErr && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{amountErr}</div>}

      {option && from && to && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.5 }}>
          Arrives at <strong style={{ color: 'var(--text-secondary)' }}>your address on {to.name}</strong>
          {address ? <> ({address.slice(0, 6)}…{address.slice(-4)})</> : null}. The network fee is paid
          in {from.nativeSymbol} on {from.name}{base ? '; the first transfer of a token also needs an approval' : ''}.
        </div>
      )}

      {busy && option && <div role="status" style={{ fontSize: 12, color: TONE.pending, marginTop: 10 }}>{stepText(step!, option)}</div>}
      {outcome && current && (
        <div role="status" style={{ fontSize: 12, color: TONE[outcome.tone], marginTop: 10, lineHeight: 1.5 }}>
          {current.status === 'RELEASED' && `✓ ${formatBridgeAmount(current.amountBaseUnits, current.decimals)} ${current.symbol} arrived on ${multxChain(current.destinationChainId).name}.`}
          {current.status === 'REVIEW' && 'Your tokens were sent, but the release on the other network isn’t confirmed yet. It stays in Recent transfers and is checked again next time you open the bridge.'}
          {current.status === 'FAILED' && 'The transfer failed on the source network, so no tokens left your wallet.'}
          {!['RELEASED', 'REVIEW', 'FAILED'].includes(current.status) && outcome.label}
        </div>
      )}
      {current && <TxLink chainId={current.sourceChainId} hash={current.sourceTxHash} label="Lock"/>}
      {current && <TxLink chainId={current.destinationChainId} hash={current.destinationTxHash} label="Release"/>}
      {err && <div role="alert" style={{ fontSize: 12, color: 'var(--red)', marginTop: 10 }}>{err}</div>}

      <button className="btn-primary" style={{ marginTop: 14 }} disabled={!canRun} onClick={run}>
        {!canSign ? 'This account can’t sign here' : busy ? 'Bridging…' : `Bridge${option ? ` ${option.symbol}` : ''}${to ? ` to ${to.name}` : ''}`}
      </button>

      {history.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="field-label">Recent transfers</div>
          {history.slice(0, 8).map((t) => {
            const l = bridgeTransferLabel(t);
            const href = t.sourceTxHash ? multxChain(t.sourceChainId).explorerTx?.(t.sourceTxHash) : undefined;
            return (
              <div key={t.integrationRequestId} className="fee-row" style={{ alignItems: 'center' }}>
                <span>
                  {formatBridgeAmount(t.amountBaseUnits, t.decimals)} {t.symbol}
                  <span style={{ color: 'var(--text-muted)' }}> · {multxChain(t.sourceChainId).name} → {multxChain(t.destinationChainId).name}</span>
                </span>
                {href
                  ? <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: TONE[l.tone], fontSize: 12, fontWeight: 600 }}>{l.label}</a>
                  : <span style={{ color: TONE[l.tone], fontSize: 12, fontWeight: 600 }}>{l.label}</span>}
              </div>
            );
          })}
        </div>
      )}

      {release && (
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 12 }}>
          MultX release {release.tag} · {release.commit.slice(0, 7)}
        </div>
      )}
    </>
  );
}
