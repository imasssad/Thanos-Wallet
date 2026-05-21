'use client';
/**
 * Portfolio value chart for the dashboard hero. Plots the real
 * CoinGecko price history of tracked holdings (see lib/price-history);
 * placeholder-priced ecosystem tokens are held flat, so a portfolio
 * with no tracked coins renders an honest flat line.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { fetchPortfolioHistory, type Holding, type Range, type PortfolioHistory } from '../lib/price-history';

const RANGES: Range[] = ['7d', '30d'];
const W = 600;
const H = 120;

function buildPath(points: number[], w: number, h: number): { line: string; area: string } {
  if (points.length < 2) return { line: '', area: '' };
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const dx = w / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = i * dx;
    // 6px top/bottom padding so the stroke isn't clipped.
    const y = h - 6 - ((p - min) / span) * (h - 12);
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  return { line, area };
}

export function PortfolioChart({ holdings, hidden = false }: { holdings: Holding[]; hidden?: boolean }) {
  const [range, setRange] = useState<Range>('7d');
  const [data, setData]   = useState<PortfolioHistory | null>(null);
  const [loading, setLoading] = useState(true);

  // Stable key so we don't refetch on every render — only when the
  // holdings set or their values actually change.
  const holdingsKey = useMemo(
    () => holdings.map(h => `${h.sym}:${h.qty.toFixed(6)}`).join('|'),
    [holdings],
  );

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    fetchPortfolioHistory(holdings, range)
      .then(d => { if (!cancel) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdingsKey, range]);

  const up = (data?.changePct ?? 0) >= 0;
  const stroke = up ? 'var(--green, #10b981)' : 'var(--red, #ef4444)';
  const { line, area } = useMemo(
    () => buildPath(data?.points ?? [], W, H),
    [data],
  );

  return (
    <div style={{ marginTop: 4 }}>
      {/* Range toggle */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 8 }}>
        {RANGES.map(r => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            style={{
              padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700,
              cursor: 'pointer', border: '1px solid var(--border-subtle)',
              background: range === r ? 'var(--bg-elevated)' : 'transparent',
              color: range === r ? 'var(--text-primary)' : 'var(--text-muted)',
              letterSpacing: 0.4,
            }}
          >
            {r.toUpperCase()}
          </button>
        ))}
      </div>

      <div style={{ position: 'relative', height: H, opacity: hidden ? 0.25 : 1, transition: 'opacity .2s' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          width="100%" height={H}
          style={{ display: 'block', filter: loading ? 'grayscale(1)' : 'none', opacity: loading ? 0.5 : 1 }}
        >
          <defs>
            <linearGradient id="pf-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={stroke} stopOpacity="0.22"/>
              <stop offset="100%" stopColor={stroke} stopOpacity="0"/>
            </linearGradient>
          </defs>
          {area && <path d={area} fill="url(#pf-fill)" stroke="none"/>}
          {line && <path d={line} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"/>}
        </svg>
      </div>

      {data && !data.hasRealData && !loading && (
        <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', marginTop: 4, letterSpacing: 0.3 }}>
          No price history for your current holdings yet.
        </div>
      )}
    </div>
  );
}
