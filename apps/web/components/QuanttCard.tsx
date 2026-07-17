'use client';
/**
 * Quantt Agents card — web's version of the AI-assistant card the desktop /
 * extension / mobile clients ship (the .ai-* classes in globals.css were
 * ported with the desktop styles and were unused until this card).
 *
 * The web wallet is itself a website — it cannot inject a provider into a
 * cross-origin quantts.ai tab, so Quantt's "Sign in with Thanos" needs a
 * wallet at the destination. Two paths:
 *   • Desktop browser → the Thanos EXTENSION serves quantts.ai. The card
 *     opens the site in a new tab; when the extension isn't detected we show
 *     an install CTA under the card (sign-in won't work without it).
 *   • Phone browser → no extension exists on mobile; hand off to the native
 *     app's in-app browser via thanoswallet://open?url=… (provider injected
 *     there — the mobile App.tsx allowlists quantts.ai for this route). If
 *     the app never takes over, a fallback row appears with a plain link +
 *     (Android) a Play-Store link, instead of auto-opening anything — a
 *     delayed window.open would hit popup blockers.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { detectPlatform, useExtensionInstalled, CHROME_STORE_URL, PLAY_STORE_URL, type Platform } from './ExtensionPrompt';

const QUANTT_AGENTS_URL = 'https://quantts.ai';
const APP_DEEP_LINK = `thanoswallet://open?url=${encodeURIComponent(QUANTT_AGENTS_URL)}`;

export function QuanttCard() {
  const installed = useExtensionInstalled();
  const [platform, setPlatform] = useState<Platform | null>(null);
  // Phone path: true after a deep-link attempt visibly failed (app not
  // installed) — flips on the fallback row below the card.
  const [showFallback, setShowFallback] = useState(false);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform());
    return () => { if (fallbackTimer.current) clearTimeout(fallbackTimer.current); };
  }, []);

  const isPhone = platform === 'android' || platform === 'ios';

  const openQuantt = () => {
    if (!isPhone) {
      // Desktop: the extension (when installed) injects into the new tab —
      // full sign-in. Direct user gesture, so window.open isn't blocked.
      window.open(QUANTT_AGENTS_URL, '_blank', 'noopener,noreferrer');
      return;
    }
    // Phone: try the native app. If it takes over, this page hides and the
    // timer is cleared; if nothing handles the scheme, reveal the fallback
    // row (no auto-navigation — popup blockers eat delayed window.open).
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    fallbackTimer.current = setTimeout(() => {
      if (!document.hidden) setShowFallback(true);
    }, 1600);
    const clear = () => { if (fallbackTimer.current) clearTimeout(fallbackTimer.current); };
    window.addEventListener('pagehide', clear, { once: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); }, { once: true });
    window.location.href = APP_DEEP_LINK;
  };

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg, 16px)',
        padding: 18,
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={openQuantt}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openQuantt(); } }}
        style={{ cursor: 'pointer' }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 11 }}>
          AI Assistant
        </div>
        <div className="ai-body">
          <div className="ai-icon"><Sparkles size={16}/></div>
          <div>
            <div className="ai-title">Quantt Agents ↗</div>
            <div className="ai-sub">Your AI assistant — optimize your portfolio balance across chains.</div>
          </div>
        </div>
      </div>

      {/* Desktop without the extension: sign-in on quantts.ai has no wallet
          to talk to — surface the install CTA rather than let it fail cold. */}
      {platform === 'desktop' && !installed && (
        <a
          href={CHROME_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{ display: 'inline-block', marginTop: 12, color: 'var(--blue)', fontSize: 12.5, fontWeight: 600, textDecoration: 'none' }}
        >
          Install the Thanos extension to sign in ›
        </a>
      )}

      {/* Phone fallback — the deep link went unhandled (app not installed). */}
      {showFallback && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12, fontSize: 12.5 }}>
          <span style={{ color: 'var(--text-muted)' }}>
            Sign-in works inside the Thanos app.
          </span>
          {platform === 'android' && (
            <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
               style={{ color: 'var(--blue)', fontWeight: 600, textDecoration: 'none' }}>
              Get the app on Google Play ›
            </a>
          )}
          <a href={QUANTT_AGENTS_URL} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
             style={{ color: 'var(--blue)', fontWeight: 600, textDecoration: 'none' }}>
            Continue to quantts.ai anyway ›
          </a>
        </div>
      )}
    </div>
  );
}
