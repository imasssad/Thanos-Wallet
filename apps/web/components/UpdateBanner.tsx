'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

/**
 * "New version available" banner.
 *
 * Public pages are cached at the edge for up to an hour (see
 * next.config.js's CACHE_PUBLIC_PAGE), so a tab left open can sit on a
 * stale bundle well after a deploy — a plain refresh doesn't help if the
 * cached HTML/JS hasn't rolled over yet either. This polls GET /api/version
 * (always read fresh, never cached) every 5 minutes and compares it to
 * NEXT_PUBLIC_APP_VERSION, the version baked into THIS bundle at build
 * time. A mismatch means a newer build is live; "Refresh" does a hard
 * reload (bypassing the client-side cache) to pick it up.
 */
const POLL_MS = 5 * 60 * 1000;
const BUILD_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '';

export function UpdateBanner() {
  const [newVersion, setNewVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!BUILD_VERSION) return; // no baked-in version to compare against — skip
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const { version } = (await res.json()) as { version?: string };
        if (!cancelled && version && version !== BUILD_VERSION) setNewVersion(version);
      } catch { /* offline / blip — try again next interval */ }
    };

    check();
    const id = setInterval(check, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!newVersion) return null;

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: 16,
        right: 16,
        bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
        maxWidth: 420,
        margin: '0 auto',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 10px 10px 16px',
        borderRadius: 14,
        background: 'linear-gradient(135deg, #3b7af7 0%, #6366f1 100%)',
        color: '#fff',
        boxShadow: '0 12px 34px rgba(59,122,247,0.45)',
        fontFamily: 'inherit',
      }}
    >
      <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>A new version of Thanos Wallet is available.</span>
      <button
        onClick={() => window.location.reload()}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'rgba(255,255,255,0.16)', border: 'none', color: '#fff',
          borderRadius: 10, padding: '8px 12px', fontSize: 13, fontWeight: 700,
          cursor: 'pointer', font: 'inherit', whiteSpace: 'nowrap',
        }}
      >
        <RefreshCw size={15} strokeWidth={2.4}/>
        Refresh
      </button>
    </div>
  );
}
