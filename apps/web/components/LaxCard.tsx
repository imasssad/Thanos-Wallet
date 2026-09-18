'use client';

import React, { useEffect, useState } from 'react';
import {
  Check, ChevronLeft, Plus, CreditCard, Shield, ShieldOff, MoreHorizontal, AlertTriangle,
  Eye, EyeOff, ExternalLink,
} from 'lucide-react';
import {
  laxStatus, laxCards, laxCardTransactions, laxCurrencies, laxTopUp,
  laxRegisterThanosAccount, hasThanosAccount, cardNumberOf,
  laxIssueCard, laxCardDetails, laxSetCardStatus, findKycUrl,
  type LaxStatus, type LaxCard as LaxCardT, type LaxTxn, type LaxCardDetails,
} from '../lib/lax';
import { apiClient } from '../lib/auth-client';

/**
 * LAX virtual card — fully-native flow (ported from apps/mobile's
 * LaxCardFlow in App.tsx). Everything goes through the Thanos backend LAX
 * proxy (services/api/src/routes/lax.ts); the LAX API key never touches
 * the client. No sandbox exists upstream, so once `configured` is true,
 * top-ups move real funds — there's no fake "test mode".
 *
 * View-state machine (matches mobile exactly):
 *   intro -> (soon | create) -> dashboard -> topup -> success -> dashboard
 */

const LAX_LEARN_URL = 'https://lax.money';

type LaxView = 'intro' | 'soon' | 'create' | 'dashboard' | 'topup' | 'success';

const VIEW_TITLE: Record<LaxView, string> = {
  intro:     'LAX Card',
  soon:      'LAX Card',
  create:    'Create Your LAX Card',
  dashboard: 'LAX Card',
  topup:     'Top Up LAX Card',
  success:   '',
};

/* ── card art — same visual identity as the home-screen promo ────────── */

function LaxCardArt({ last4, active }: { last4?: string; active?: boolean }) {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '1.586 / 1',
        borderRadius: 16,
        overflow: 'hidden',
        background: 'radial-gradient(130% 130% at 50% -10%, #141a2e 0%, #0a0d18 55%, #05070f 100%)',
        border: '1px solid rgba(59,122,247,0.28)',
        boxShadow: '0 18px 44px rgba(0,0,0,0.55)',
      }}
    >
      <img
        src="/images/tokens/lax.png"
        alt=""
        aria-hidden
        style={{
          position: 'absolute', top: '50%', left: '52%', transform: 'translate(-50%,-50%)',
          width: '42%', opacity: 0.45, filter: 'drop-shadow(0 0 26px rgba(59,122,247,0.45))',
        }}
      />
      <div
        style={{
          position: 'absolute', top: '8%', left: '6%',
          fontSize: 'clamp(18px, 5.2vw, 30px)', fontWeight: 800, letterSpacing: '0.34em',
          background: 'linear-gradient(90deg,#5b8cff,#9bb0ff)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}
      >
        LAX
      </div>
      {last4 && (
        <div style={{ position: 'absolute', bottom: '10%', left: '6%', color: '#9db8ff', fontSize: 13, fontWeight: 600, letterSpacing: 2 }}>
          •••• {last4}
        </div>
      )}
      <div style={{ position: 'absolute', bottom: '9%', right: '6%', textAlign: 'right', lineHeight: 1 }}>
        <div
          style={{
            fontSize: 'clamp(20px, 6vw, 34px)', fontWeight: 800, fontStyle: 'italic', letterSpacing: '0.01em',
            background: 'linear-gradient(90deg,#1a3fd6,#3b7af7)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}
        >
          VISA
        </div>
        <div style={{ fontSize: 'clamp(9px, 2.6vw, 13px)', fontWeight: 500, color: '#5b8cff', marginTop: 1 }}>
          {active ? 'Virtual' : 'Algorithmic'}
        </div>
      </div>
    </div>
  );
}

const BENEFITS = [
  'Get a LAX Debit Card for free',
  'Unlimited top-ups with 0 fees',
  'Accepted worldwide where Visa™ is accepted',
];

function Benefits() {
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {BENEFITS.map(b => (
        <li key={b} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, color: 'var(--text-secondary)', fontSize: 13.5, lineHeight: 1.4 }}>
          <Check size={16} color="var(--blue)" strokeWidth={2.6} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>{b}</span>
        </li>
      ))}
    </ul>
  );
}

/** Home-screen promo block — sits below the assets list. Unchanged. */
export function LaxCardPromo({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg, 16px)',
        padding: 18,
        display: 'flex', flexDirection: 'column', gap: 16,
      }}
    >
      <LaxCardArt />
      <div>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 10, color: 'var(--text-primary)' }}>
          Own Your Crypto Virtual Card
        </div>
        <Benefits />
      </div>
      <a
        href={LAX_LEARN_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{ alignSelf: 'center', color: 'var(--blue)', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
      >
        Learn more ›
      </a>
      <button className="btn-primary" onClick={onGetStarted} style={{ width: '100%' }}>
        Get Started
      </button>
    </div>
  );
}

/* ── screens ───────────────────────────────────────────────────────────── */

const LAX_INTRO_BENEFITS = ['Free virtual card', 'Top up with crypto', 'No hidden fees', 'Accepted worldwide'];

function LaxIntro({ notLive, onStart }: { notLive: boolean; onStart: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <LaxCardArt />
      <div style={{ color: 'var(--text-primary)', fontSize: 20, fontWeight: 800, textAlign: 'center' }}>
        Own Your Crypto<br />In The Real World
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5, textAlign: 'center', margin: 0 }}>
        The LAX Card lets you spend your crypto globally, anywhere Visa™ is accepted.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
        {LAX_INTRO_BENEFITS.map(b => (
          <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Check size={16} color="var(--blue)" strokeWidth={2.6} />
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{b}</span>
          </div>
        ))}
      </div>
      <button className="btn-primary" onClick={onStart} style={{ width: '100%', marginTop: 8 }}>
        Get Started
      </button>
      <a
        href={LAX_LEARN_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{ textAlign: 'center', padding: '8px 0', color: 'var(--blue)', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
      >
        Learn more
      </a>
      {notLive && (
        <p style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'center', lineHeight: 1.45, margin: 0 }}>
          Native card issuance is rolling out — you can still explore the flow.
        </p>
      )}
    </div>
  );
}

function LaxComingSoon({ onClose }: { onClose: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', paddingTop: 20 }}>
      <LaxCardArt />
      <div style={{ color: 'var(--text-primary)', fontSize: 18, fontWeight: 800, textAlign: 'center', marginTop: 8 }}>
        LAX cards aren&apos;t live yet
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5, textAlign: 'center', margin: 0 }}>
        Native issuance, top-ups and balance land as soon as the LAX partner setup is finished. Until then you can apply on the LAX site.
      </p>
      <a
        className="btn-primary"
        href={LAX_LEARN_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{ width: '100%', textAlign: 'center', textDecoration: 'none', marginTop: 6 }}
      >
        Apply on lax.money ↗
      </a>
      <button className="btn-link" onClick={onClose} style={{ padding: '8px 0' }}>
        Not now
      </button>
    </div>
  );
}

const LAX_KYC_STEPS = [
  'Prepare your Passport or ID card',
  'Be at your home',
  'Allow location access',
  'Take a selfie',
];

const LAX_CREATE_QUICK = [50, 100, 200, 500];

type CreateStep = 'account' | 'amount' | 'verifying';

const CREATE_STEP_RAIL: { step: CreateStep; label: string }[] = [
  { step: 'account',   label: 'Account'  },
  { step: 'amount',    label: 'Amount'   },
  { step: 'verifying', label: 'Verify'   },
];

function LaxCreate({ status, onDone }: { status: LaxStatus | null; onDone: () => void }) {
  const [step, setStep]     = useState<CreateStep>('account');
  const [checking, setChecking] = useState(true);

  const [email, setEmail]   = useState('');
  const [pwd, setPwd]       = useState('');
  const [agreed, setAgreed] = useState(false);

  const [amount, setAmount]         = useState('');
  const [currency, setCurrency]     = useState('USDT');
  const [currencies, setCurrencies] = useState<string[]>(['USDT', 'LITHO', 'ETH', 'BNB']);

  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);

  // If a Thanos account already exists, skip straight to the amount step —
  // pull the account's email so laxIssueCard still gets one.
  useEffect(() => {
    (async () => {
      try {
        if (await hasThanosAccount()) {
          try {
            const me = await apiClient.me();
            if (me?.email) setEmail(me.email);
          } catch { /* keep email blank — the amount step still works */ }
          setStep('amount');
        }
      } finally { setChecking(false); }
    })();
  }, []);

  useEffect(() => {
    if (step !== 'amount') return;
    (async () => {
      try {
        const raw = await laxCurrencies();
        const arr = Array.isArray(raw) ? raw : (raw as { currencies?: unknown; data?: unknown })?.currencies ?? (raw as { data?: unknown })?.data;
        if (Array.isArray(arr) && arr.length) {
          setCurrencies(
            arr.map((x: unknown) => {
              const o = x as { symbol?: string; code?: string } | string;
              return String(typeof o === 'string' ? o : o?.symbol ?? o?.code ?? '');
            }).filter(Boolean).slice(0, 12)
          );
        }
      } catch { /* keep the fallback list */ }
    })();
  }, [step]);

  const submitAccount = async () => {
    setErr(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErr('Enter a valid email.'); return; }
    if (pwd.length < 8) { setErr('Password must be at least 8 characters.'); return; }
    setBusy(true);
    try {
      if (!(await hasThanosAccount())) {
        await laxRegisterThanosAccount({ email: email.trim(), password: pwd });
      }
      if (status?.configuredForIssuance) {
        setStep('amount');
      } else {
        onDone();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create your account — try again.');
    } finally { setBusy(false); }
  };

  const submitAmount = async () => {
    setErr(null);
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setErr('Enter an amount.'); return; }
    setBusy(true);
    try {
      const res = await laxIssueCard({ amount: amt, currency, email: email.trim() });
      const url = findKycUrl(res);
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
        setStep('verifying');
      } else {
        onDone();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not issue your card — try again.');
    } finally { setBusy(false); }
  };

  const activeIdx = CREATE_STEP_RAIL.findIndex(s => s.step === step);

  if (checking) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
        <div style={{
          width: 24, height: 24, borderRadius: '50%', border: '3px solid var(--border-default)',
          borderTopColor: 'var(--blue)', animation: 'spin 0.8s linear infinite',
        }} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* step rail */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px' }}>
        {CREATE_STEP_RAIL.map((s, i) => (
          <React.Fragment key={s.step}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 26, height: 26, borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: i <= activeIdx ? 'var(--blue)' : 'var(--bg-elevated)',
              }}>
                {i < activeIdx
                  ? <Check size={13} color="#fff" strokeWidth={3} />
                  : <span style={{ color: i === activeIdx ? '#fff' : 'var(--text-muted)', fontSize: 12, fontWeight: 800 }}>{i + 1}</span>}
              </div>
              <span style={{ color: i === activeIdx ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 11 }}>{s.label}</span>
            </div>
            {i < CREATE_STEP_RAIL.length - 1 && <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)', margin: '0 6px' }} />}
          </React.Fragment>
        ))}
      </div>

      {step === 'account' && (
        <>
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>During verification you will need to:</span>
            {LAX_KYC_STEPS.map(s => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Check size={15} color="var(--blue)" strokeWidth={2.4} />
                <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>{s}</span>
              </div>
            ))}
          </div>

          <div>
            <label className="field-label">Email</label>
            <input className="field-input" type="email" autoComplete="email" placeholder="you@example.com"
              value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Password</label>
            <input className="field-input" type="password" autoComplete="new-password" placeholder="Min 8 characters"
              value={pwd} onChange={e => setPwd(e.target.value)} />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: 'var(--blue)', cursor: 'pointer' }} />
            <span style={{ color: 'var(--text-secondary)', fontSize: 12, flex: 1 }}>I agree to the LAX Terms &amp; Conditions</span>
          </label>

          {err && <span style={{ color: '#ef4444', fontSize: 12 }}>{err}</span>}

          <button className="btn-primary" onClick={submitAccount} disabled={!agreed || busy} style={{ width: '100%' }}>
            {busy ? 'Creating…' : 'Next'}
          </button>
          <p style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'center', lineHeight: 1.45, margin: 0 }}>
            {status?.configuredForIssuance
              ? 'Next you’ll choose a starting balance, then your virtual card is issued.'
              : 'Card issuance isn’t enabled yet — your account is created and you’ll be notified when cards go live.'}
          </p>
        </>
      )}

      {step === 'amount' && (
        <>
          <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Fund your new card to start</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {currencies.map(cur => (
              <button
                key={cur}
                onClick={() => setCurrency(cur)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 999,
                  border: `1px solid ${currency === cur ? 'var(--blue)' : 'var(--border-default)'}`,
                  background: currency === cur ? 'rgba(59,122,247,0.14)' : 'transparent',
                  color: 'var(--text-primary)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {cur}
              </button>
            ))}
          </div>

          <label className="field-label" style={{ marginTop: 4 }}>Starting balance (USD)</label>
          <input
            className="field-input" type="text" inputMode="decimal" placeholder="0.00"
            value={amount} onChange={e => setAmount(e.target.value)}
            style={{ fontSize: 22, fontWeight: 800, textAlign: 'center', padding: '14px' }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            {LAX_CREATE_QUICK.map(q => (
              <button
                key={q}
                onClick={() => setAmount(String(q))}
                className="btn-outline"
                style={{ flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 700 }}
              >
                ${q}
              </button>
            ))}
          </div>

          {err && <span style={{ color: '#ef4444', fontSize: 12 }}>{err}</span>}

          <button className="btn-primary" onClick={submitAmount} disabled={busy} style={{ width: '100%', marginTop: 4 }}>
            {busy ? 'Issuing…' : 'Issue Card'}
          </button>
        </>
      )}

      {step === 'verifying' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', paddingTop: 20 }}>
          <div style={{ width: 72, height: 72, borderRadius: 36, background: 'rgba(59,122,247,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ExternalLink size={30} color="var(--blue)" />
          </div>
          <div style={{ color: 'var(--text-primary)', fontSize: 17, fontWeight: 800, textAlign: 'center' }}>
            Complete verification in the new tab
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5, textAlign: 'center', margin: 0 }}>
            We opened identity verification in a new tab. Finish it there, then come back — your card will appear here once it&apos;s ready.
          </p>
          <button className="btn-primary" onClick={onDone} style={{ width: '100%', marginTop: 8 }}>
            Continue to Dashboard
          </button>
        </div>
      )}
    </div>
  );
}

function LaxDashboard({
  card, last4, txns, notLive, actionErr, onTopUp, onDetails, onFreeze, onMore, onSoon,
}: {
  card: LaxCardT | null; last4?: string; txns: LaxTxn[]; notLive: boolean; actionErr?: string | null;
  onTopUp: () => void; onDetails: () => void; onFreeze: () => void; onMore: () => void; onSoon: () => void;
}) {
  const balance = card?.balance != null ? Number(card.balance) : null;
  const frozen = String(card?.status || '').toLowerCase() === 'frozen';
  const noCard = notLive || !card;
  const actions = [
    { icon: Plus,                        label: 'Top Up',       onClick: noCard ? onSoon : onTopUp },
    { icon: CreditCard,                  label: 'Card Details', onClick: noCard ? onSoon : onDetails },
    { icon: frozen ? ShieldOff : Shield, label: frozen ? 'Unfreeze' : 'Freeze', onClick: noCard ? onSoon : onFreeze },
    { icon: MoreHorizontal,              label: 'More',         onClick: noCard ? onSoon : onMore },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <LaxCardArt active last4={last4} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 8, height: 8, borderRadius: 4, background: card ? '#22c55e' : 'var(--text-muted)' }} />
        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{card ? String(card.status || 'Active') : 'No card yet'}</span>
      </div>
      <div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Card Balance</div>
        <div style={{ color: 'var(--text-primary)', fontSize: 30, fontWeight: 800 }}>
          {balance != null ? `$${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        {actions.map(a => (
          <button
            key={a.label}
            onClick={a.onClick}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: 1,
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            }}
          >
            <div style={{
              width: 46, height: 46, borderRadius: 23, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(59,122,247,0.14)',
            }}>
              <a.icon size={18} color="var(--blue)" />
            </div>
            <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{a.label}</span>
          </button>
        ))}
      </div>

      {notLive && (
        <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertTriangle size={15} color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.45 }}>
            LAX isn&apos;t live yet — balance and actions will work once the partner setup is finished.
          </span>
        </div>
      )}

      {actionErr && (
        <div style={{ background: 'rgba(239,68,68,0.1)', borderRadius: 12, padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertTriangle size={15} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.45 }}>{actionErr}</span>
        </div>
      )}

      <div style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 800, marginTop: 4 }}>Recent Transactions</div>
      {txns.length === 0 ? (
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No transactions yet.</span>
      ) : txns.slice(0, 6).map((t, i) => (
        <div key={t.id || i} style={{
          display: 'flex', justifyContent: 'space-between', padding: '10px 0',
          borderBottom: i < Math.min(txns.length, 6) - 1 ? '1px solid var(--border-subtle)' : 'none',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {t.merchant || t.type || 'Transaction'}
            </div>
            {t.date && <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{t.date}</div>}
          </div>
          {t.amount != null && (
            <span style={{ color: t.amount < 0 ? 'var(--text-primary)' : '#22c55e', fontSize: 13, fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>
              {t.amount < 0 ? '' : '+'}{t.amount.toLocaleString('en-US', { style: 'currency', currency: t.currency || 'USD' })}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── card details modal (sensitive — never persisted outside this box) ── */

function maskTail(v: string | undefined, keep = 4): string {
  if (!v) return '—';
  const clean = v.replace(/\s+/g, '');
  return clean.length <= keep ? clean : '•'.repeat(clean.length - keep) + clean.slice(-keep);
}

function CardDetailsModal({ cardNo, onClose }: { cardNo: string; onClose: () => void }) {
  const [details, setDetails]   = useState<LaxCardDetails | null>(null);
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await laxCardDetails(cardNo);
        if (!cancelled) setDetails(d);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Could not load card details.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [cardNo]);

  // Never leaves sensitive data behind — cleared before the modal unmounts.
  const close = () => { setDetails(null); onClose(); };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal-box modal-popup" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span />
          <span className="modal-title">Card Details</span>
          <button className="modal-close" onClick={close}>✕</button>
        </div>
        <div className="modal-scroll">
          <div className="modal-body" style={{ gap: 16 }}>
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', border: '3px solid var(--border-default)',
                  borderTopColor: 'var(--blue)', animation: 'spin 0.8s linear infinite',
                }} />
              </div>
            ) : err ? (
              <span style={{ color: '#ef4444', fontSize: 13 }}>{err}</span>
            ) : (
              <>
                <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 11, marginBottom: 4 }}>Card Number</div>
                    <div style={{ color: 'var(--text-primary)', fontSize: 17, fontWeight: 700, fontFamily: 'Geist Mono, monospace', letterSpacing: 1 }}>
                      {revealed ? (details?.pan || 'Not available') : maskTail(details?.pan)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 28 }}>
                    <div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: 11, marginBottom: 4 }}>Expiry</div>
                      <div style={{ color: 'var(--text-primary)', fontSize: 15, fontWeight: 700, fontFamily: 'Geist Mono, monospace' }}>
                        {revealed ? `${details?.expMonth ?? '••'}/${details?.expYear ?? '••'}` : '••/••'}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: 11, marginBottom: 4 }}>CVC</div>
                      <div style={{ color: 'var(--text-primary)', fontSize: 15, fontWeight: 700, fontFamily: 'Geist Mono, monospace' }}>
                        {revealed ? String(details?.cvc ?? '—') : '•••'}
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  className={revealed ? 'btn-outline' : 'btn-primary'}
                  onClick={() => setRevealed(r => !r)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  {revealed ? <><EyeOff size={15} /> Hide</> : <><Eye size={15} /> Reveal Details</>}
                </button>

                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1, color: '#f59e0b' }} />
                  <span>Anyone with these details can spend from your card. Make sure no one is watching your screen.</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── small confirm dialog — used for freeze/unfreeze ──────────────────── */

function ConfirmDialog({
  title, message, confirmLabel, busy, onConfirm, onCancel,
}: {
  title: string; message: string; confirmLabel: string; busy?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ width: 340 }}>
        <div className="modal-body" style={{ gap: 14 }}>
          <div style={{ color: 'var(--text-primary)', fontSize: 16, fontWeight: 800 }}>{title}</div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5, margin: 0 }}>{message}</p>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button className="btn-outline" style={{ flex: 1 }} onClick={onCancel} disabled={busy}>Cancel</button>
            <button className="btn-primary" style={{ flex: 1 }} onClick={onConfirm} disabled={busy}>
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── "More" action sheet ───────────────────────────────────────────────── */

function MoreModal({ cardNo, onClose }: { cardNo: string; onClose: () => void }) {
  const [showHistory, setShowHistory] = useState(false);
  const [txns, setTxns]               = useState<LaxTxn[] | null>(null);
  const [loading, setLoading]         = useState(false);
  const [err, setErr]                 = useState<string | null>(null);

  const openHistory = async () => {
    setShowHistory(true);
    if (txns) return;
    setLoading(true);
    setErr(null);
    try {
      setTxns(await laxCardTransactions(cardNo));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load transactions.');
    } finally { setLoading(false); }
  };

  const COMING_SOON = ['Replace card', 'Report lost', 'Close card'];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box modal-popup" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          {showHistory ? (
            <button className="modal-back-btn" onClick={() => setShowHistory(false)} aria-label="Back" style={{ width: 32, height: 32 }}>
              <ChevronLeft size={20} />
            </button>
          ) : <span />}
          <span className="modal-title">{showHistory ? 'All Transactions' : 'More'}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-scroll">
          <div className="modal-body" style={{ gap: 4 }}>
            {!showHistory ? (
              <>
                <button
                  onClick={openHistory}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                    background: 'none', border: 'none', borderBottom: '1px solid var(--border-subtle)',
                    padding: '14px 2px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 14, fontWeight: 600,
                  }}
                >
                  Full Transaction History
                  <ChevronLeft size={16} style={{ transform: 'rotate(180deg)', color: 'var(--text-muted)' }} />
                </button>
                {COMING_SOON.map(label => (
                  <div
                    key={label}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                      padding: '14px 2px', borderBottom: '1px solid var(--border-subtle)',
                      color: 'var(--text-muted)', fontSize: 14, fontWeight: 600,
                    }}
                  >
                    {label}
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '3px 8px', borderRadius: 999 }}>
                      Coming soon
                    </span>
                  </div>
                ))}
              </>
            ) : loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', border: '3px solid var(--border-default)',
                  borderTopColor: 'var(--blue)', animation: 'spin 0.8s linear infinite',
                }} />
              </div>
            ) : err ? (
              <span style={{ color: '#ef4444', fontSize: 13 }}>{err}</span>
            ) : !txns || txns.length === 0 ? (
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No transactions yet.</span>
            ) : (
              txns.map((t, i) => (
                <div key={t.id || i} style={{
                  display: 'flex', justifyContent: 'space-between', padding: '10px 0',
                  borderBottom: i < txns.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.merchant || t.type || 'Transaction'}
                    </div>
                    {t.date && <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{t.date}</div>}
                  </div>
                  {t.amount != null && (
                    <span style={{ color: t.amount < 0 ? 'var(--text-primary)' : '#22c55e', fontSize: 13, fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>
                      {t.amount < 0 ? '' : '+'}{t.amount.toLocaleString('en-US', { style: 'currency', currency: t.currency || 'USD' })}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const LAX_TOPUP_QUICK = [50, 100, 200, 500];

function LaxTopUp({ cardNo, onDone }: { cardNo: string; onDone: (amt: number, cur: string) => void }) {
  const [amount, setAmount]         = useState('');
  const [currency, setCurrency]     = useState('USDT');
  const [currencies, setCurrencies] = useState<string[]>(['USDT', 'LITHO', 'ETH', 'BNB']);
  const [busy, setBusy]             = useState(false);
  const [err, setErr]               = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = await laxCurrencies();
        const arr = Array.isArray(raw) ? raw : (raw as { currencies?: unknown; data?: unknown })?.currencies ?? (raw as { data?: unknown })?.data;
        if (Array.isArray(arr) && arr.length) {
          setCurrencies(
            arr.map((x: unknown) => {
              const o = x as { symbol?: string; code?: string } | string;
              return String(typeof o === 'string' ? o : o?.symbol ?? o?.code ?? '');
            }).filter(Boolean).slice(0, 12)
          );
        }
      } catch { /* keep the fallback list */ }
    })();
  }, []);

  const submit = async () => {
    setErr(null);
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setErr('Enter an amount.'); return; }
    setBusy(true);
    try {
      await laxTopUp({ cardNumber: cardNo, amount: amt });
      onDone(amt, currency);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Top up failed — try again.');
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Select crypto to top up with</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {currencies.map(cur => (
          <button
            key={cur}
            onClick={() => setCurrency(cur)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 999,
              border: `1px solid ${currency === cur ? 'var(--blue)' : 'var(--border-default)'}`,
              background: currency === cur ? 'rgba(59,122,247,0.14)' : 'transparent',
              color: 'var(--text-primary)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {cur}
          </button>
        ))}
      </div>

      <label className="field-label" style={{ marginTop: 4 }}>Top up amount (USD)</label>
      <input
        className="field-input" type="text" inputMode="decimal" placeholder="0.00"
        value={amount} onChange={e => setAmount(e.target.value)}
        style={{ fontSize: 22, fontWeight: 800, textAlign: 'center', padding: '14px' }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        {LAX_TOPUP_QUICK.map(q => (
          <button
            key={q}
            onClick={() => setAmount(String(q))}
            className="btn-outline"
            style={{ flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 700 }}
          >
            ${q}
          </button>
        ))}
      </div>

      {err && <span style={{ color: '#ef4444', fontSize: 12 }}>{err}</span>}

      <button className="btn-primary" onClick={submit} disabled={busy} style={{ width: '100%', marginTop: 4 }}>
        {busy ? 'Processing…' : 'Top Up'}
      </button>
    </div>
  );
}

function LaxSuccess({ last4, topUp, onDone }: { last4?: string; topUp: { amount: number; currency: string } | null; onDone: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', paddingTop: 24 }}>
      <div style={{ width: 84, height: 84, borderRadius: 42, background: 'rgba(34,197,94,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Check size={40} color="#22c55e" strokeWidth={3} />
      </div>
      <div style={{ color: 'var(--text-primary)', fontSize: 22, fontWeight: 800 }}>Top Up Successful!</div>
      {topUp && (
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, textAlign: 'center', margin: 0 }}>
          <span style={{ color: 'var(--text-primary)', fontWeight: 800 }}>
            ${Number(topUp.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </span>{' '}
          has been added to your LAX Card •••• {last4}
        </p>
      )}
      <button className="btn-primary" onClick={onDone} style={{ width: '100%', marginTop: 12 }}>
        Done
      </button>
    </div>
  );
}

/* ── shell / view-state machine ───────────────────────────────────────── */

export function LaxCardModal({ onClose }: { onClose: () => void }) {
  const [view, setView]           = useState<LaxView>('intro');
  const [booting, setBooting]     = useState(true);
  const [status, setStatus]       = useState<LaxStatus | null>(null);
  const [cards, setCards]         = useState<LaxCardT[]>([]);
  const [card, setCard]           = useState<LaxCardT | null>(null);
  const [txns, setTxns]           = useState<LaxTxn[]>([]);
  const [lastTopUp, setLastTopUp] = useState<{ amount: number; currency: string } | null>(null);

  const [showDetails, setShowDetails]     = useState(false);
  const [showMore, setShowMore]           = useState(false);
  const [confirmFreeze, setConfirmFreeze] = useState(false);
  const [freezeBusy, setFreezeBusy]       = useState(false);
  const [actionErr, setActionErr]         = useState<string | null>(null);

  const cardNo = card ? cardNumberOf(card) : undefined;
  const last4  = cardNo ? cardNo.slice(-4) : (typeof card?.last4 === 'string' ? card.last4 : '••••');
  const frozen = String(card?.status || '').toLowerCase() === 'frozen';

  const doFreezeToggle = async () => {
    if (!cardNo) return;
    setFreezeBusy(true);
    setActionErr(null);
    try {
      await laxSetCardStatus(cardNo, frozen ? 'active' : 'frozen');
      await refresh();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Could not update card status — try again.');
    } finally {
      setFreezeBusy(false);
      setConfirmFreeze(false);
    }
  };

  const refresh = async () => {
    try {
      const st = await laxStatus();
      setStatus(st);
      if (st.configured) {
        const list = await laxCards();
        setCards(list);
        if (list[0]) {
          setCard(list[0]);
          const cn = cardNumberOf(list[0]);
          if (cn) { laxCardTransactions(cn).then(setTxns).catch(() => setTxns([])); }
        }
      }
    } catch { /* leave status null — treated as not-live */ }
  };

  useEffect(() => {
    (async () => {
      await refresh();
      setBooting(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Land on the dashboard when the user already has a card.
  useEffect(() => {
    if (!booting && cards.length > 0 && view === 'intro') setView('dashboard');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booting, cards.length]);

  const notLive = !status?.configured;
  const canGoBack = view !== 'intro' && view !== 'dashboard';
  const title = VIEW_TITLE[view];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box modal-popup" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          {canGoBack ? (
            <button className="modal-back-btn" onClick={() => setView('dashboard')} aria-label="Back" style={{ width: 32, height: 32 }}>
              <ChevronLeft size={20} />
            </button>
          ) : <span />}
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-scroll">
          <div className="modal-body" style={{ gap: 18 }}>
            {booting ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', border: '3px solid var(--border-default)',
                  borderTopColor: 'var(--blue)', animation: 'spin 0.8s linear infinite',
                }} />
                <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
              </div>
            ) : (
              <>
                {view === 'intro'      && <LaxIntro notLive={notLive} onStart={() => setView(notLive ? 'soon' : 'create')} />}
                {view === 'soon'       && <LaxComingSoon onClose={onClose} />}
                {view === 'create'     && <LaxCreate status={status} onDone={async () => { await refresh(); setView(status?.configuredForIssuance ? 'dashboard' : 'soon'); }} />}
                {view === 'dashboard'  && (
                  <LaxDashboard
                    card={card} last4={last4} txns={txns} notLive={notLive} actionErr={actionErr}
                    onTopUp={() => setView('topup')}
                    onDetails={() => { setActionErr(null); setShowDetails(true); }}
                    onFreeze={() => { setActionErr(null); setConfirmFreeze(true); }}
                    onMore={() => { setActionErr(null); setShowMore(true); }}
                    onSoon={() => setView('soon')}
                  />
                )}
                {view === 'topup' && cardNo && (
                  <LaxTopUp cardNo={cardNo} onDone={(amt, cur) => { setLastTopUp({ amount: amt, currency: cur }); refresh(); setView('success'); }} />
                )}
                {view === 'success'    && <LaxSuccess last4={last4} topUp={lastTopUp} onDone={() => setView('dashboard')} />}
              </>
            )}
          </div>
        </div>
      </div>

      {showDetails && cardNo && (
        <CardDetailsModal cardNo={cardNo} onClose={() => setShowDetails(false)} />
      )}

      {confirmFreeze && cardNo && (
        <ConfirmDialog
          title={frozen ? 'Unfreeze this card?' : 'Freeze this card?'}
          message={frozen
            ? 'Your card will be usable for purchases again immediately.'
            : 'Your card will be declined for any new purchases until you unfreeze it.'}
          confirmLabel={frozen ? 'Unfreeze' : 'Freeze'}
          busy={freezeBusy}
          onConfirm={doFreezeToggle}
          onCancel={() => setConfirmFreeze(false)}
        />
      )}

      {showMore && cardNo && (
        <MoreModal cardNo={cardNo} onClose={() => setShowMore(false)} />
      )}
    </div>
  );
}
