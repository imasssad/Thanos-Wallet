'use client';

import React from 'react';
import { Check } from 'lucide-react';

/**
 * LAX virtual card — home-screen promo + "Get Started" detail modal.
 *
 * The card art is a faithful CSS recreation of the lax.money card (dark body,
 * LAX wordmark, faded MultX emblem, "VISA Algorithmic"). When the real card
 * PNG is supplied, drop it at /public/images/lax-card.png and swap LaxCardArt's
 * body for an <img>.
 *
 * NOTE: native in-app issuance / balance / management is gated on the LAX
 * partner API. Until that lands, "Get Started" opens the LAX application at
 * lax.money. Repoint `LAX_APPLY_URL` (or wire the native flow) when ready.
 */

// LAX application page (dashboard register — supports ?address=<0x…> prefill;
// address plumbing to this card is a queued follow-up).
const LAX_APPLY_URL = 'https://dashboard.lax.money/register#individual';

const BENEFITS = [
  'Get a LAX Debit Card for free',
  'Unlimited top-ups with 0 fees',
  'Accepted worldwide where Visa™ is accepted',
];

/** CSS recreation of the LAX Visa card art. */
function LaxCardArt() {
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
      {/* faded emblem */}
      <img
        src="/images/tokens/lax.png"
        alt=""
        aria-hidden
        style={{
          position: 'absolute', top: '50%', left: '52%', transform: 'translate(-50%,-50%)',
          width: '42%', opacity: 0.45, filter: 'drop-shadow(0 0 26px rgba(59,122,247,0.45))',
        }}
      />
      {/* LAX wordmark */}
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
      {/* VISA Algorithmic */}
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
          Algorithmic
        </div>
      </div>
    </div>
  );
}

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

/** Home-screen promo block — sits below the assets list. */
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
        href={LAX_APPLY_URL}
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

/** "Get Started" detail modal — bigger card + benefits + apply CTA. */
export function LaxCardModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box modal-popup" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">LAX Virtual Card</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-scroll">
          <div className="modal-body" style={{ gap: 18 }}>
            <LaxCardArt />
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>
              Own Your Crypto Virtual Card
            </div>
            <Benefits />
            <a
              className="btn-primary"
              href={LAX_APPLY_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ width: '100%', textAlign: 'center', textDecoration: 'none' }}
            >
              Get Started
            </a>
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5, margin: 0 }}>
              Native in-app issuance, top-ups and balance are rolling out — you&apos;ll soon apply and manage your card right here in Thanos.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
