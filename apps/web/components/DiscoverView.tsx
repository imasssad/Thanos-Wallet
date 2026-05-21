'use client';
/**
 * Discover / Explore — a directory of Lithosphere ecosystem apps that
 * open in the browser (a new tab on web). Mirrors the Trust Wallet
 * "Explore" experience: search, a featured hub CTA, and a categorised
 * app list with a safety reminder.
 */
import React, { useState } from 'react';
import { ExternalLink, Search, ShieldCheck, ChevronRight, Globe } from 'lucide-react';
import { ECOSYSTEM_APPS, ECOSYSTEM_HUB, type EcosystemApp } from '../lib/ecosystem';

function AppIcon({ app, size = 44 }: { app: EcosystemApp; size?: number }) {
  const [failed, setFailed] = useState(false);
  const showImg = app.icon && !failed;
  return (
    <div style={{
      position: 'relative', width: size, height: size, borderRadius: 14,
      background: app.color, color: '#ffffff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.floor(size * 0.4), fontWeight: 700, overflow: 'hidden', flexShrink: 0,
    }}>
      <span style={{ position: 'absolute' }}>{app.name.charAt(0)}</span>
      {showImg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={app.icon} alt="" width={size} height={size}
          onError={() => setFailed(true)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </div>
  );
}

export function DiscoverView() {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const apps = query
    ? ECOSYSTEM_APPS.filter(a =>
        a.name.toLowerCase().includes(query) ||
        a.category.toLowerCase().includes(query) ||
        a.description.toLowerCase().includes(query))
    : ECOSYSTEM_APPS;

  const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

  return (
    <div className="page-wrap" style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="page-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
        <h1 className="page-title">Discover</h1>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Apps from the Lithosphere ecosystem — open in your browser.
        </div>
      </div>

      {/* Search */}
      <div style={{ position: 'relative', margin: '14px 0' }}>
        <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}/>
        <input
          className="field-input"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search ecosystem apps"
          style={{ paddingLeft: 36 }}
        />
      </div>

      {/* Featured: the full ecosystem hub */}
      <a
        href={ECOSYSTEM_HUB}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex', alignItems: 'center', gap: 14, padding: 16,
          borderRadius: 16, marginBottom: 20,
          background: 'linear-gradient(135deg, rgba(59,122,247,0.16), rgba(139,125,247,0.12))',
          border: '1px solid var(--border-default)',
          textDecoration: 'none', color: 'inherit',
        }}
      >
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: 'rgba(59,122,247,0.18)', color: 'var(--blue)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Globe size={22}/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Explore Web3</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Browse the full Lithosphere ecosystem on ecosystem.litho.ai
          </div>
        </div>
        <ExternalLink size={16} color="var(--text-muted)"/>
      </a>

      {/* App list */}
      <div style={{
        fontSize: 13, fontWeight: 700, color: 'var(--text-muted)',
        letterSpacing: 0.4, marginBottom: 8, textTransform: 'uppercase',
      }}>
        Lithosphere Ecosystem
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {apps.map((a, i) => (
          <button
            key={a.id}
            onClick={() => open(a.url)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 14,
              padding: '14px 16px', background: 'transparent', border: 'none',
              borderBottom: i < apps.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              cursor: 'pointer', textAlign: 'left', color: 'inherit',
            }}
          >
            <AppIcon app={a}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{a.name}</span>
                <span style={{
                  fontSize: 10, padding: '2px 6px', borderRadius: 4,
                  background: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontWeight: 600,
                }}>{a.category}</span>
              </div>
              <div style={{
                fontSize: 12, color: 'var(--text-muted)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{a.description}</div>
            </div>
            <ChevronRight size={18} color="var(--text-muted)"/>
          </button>
        ))}
        {apps.length === 0 && (
          <div style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)' }}>No apps match “{q}”.</div>
        )}
      </div>

      {/* Safety reminder — Trust Wallet-style trust cue */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 14,
        fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5,
      }}>
        <ShieldCheck size={14} style={{ flexShrink: 0, marginTop: 1, color: 'var(--green, #10b981)' }}/>
        <span>
          These are Lithosphere ecosystem apps. Always check the URL in your browser
          before connecting your wallet or signing a transaction.
        </span>
      </div>
    </div>
  );
}
