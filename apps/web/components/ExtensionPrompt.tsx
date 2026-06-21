'use client';

import React, { useEffect, useState } from 'react';
import { Puzzle, X, Smartphone, Download } from 'lucide-react';

/**
 * Platform-aware install prompt for thanos.fi visitors.
 *
 * Rules:
 *  - Android phone/tablet → "Download the Android app" → /download (the APK).
 *  - Desktop browser      → "Get the extension" → Chrome Web Store / AMO,
 *                           hidden once the Thanos extension is detected
 *                           (window.thanos.isThanos + EIP-6963 handshake).
 *  - iOS / iPadOS         → nothing yet (no App Store build to offer; browser
 *                           extensions don't exist on iOS Safari either).
 *  - Dismissible per surface; the choice is remembered in localStorage.
 *
 * Rendered once on the landing page (app/page.tsx).
 *
 * TODO: STORE_URL points at each store's search for "Thanos Wallet" until the
 * listings are published — swap in the real listing URLs when they go live.
 */

const DISMISS_EXT = 'thanos_ext_prompt_dismissed';
const DISMISS_APK = 'thanos_apk_prompt_dismissed';

const STORE_URL: Record<'chrome' | 'firefox', string> = {
  chrome:  'https://chromewebstore.google.com/search/Thanos%20Wallet',
  firefox: 'https://addons.mozilla.org/firefox/search/?q=Thanos%20Wallet',
};

type Platform = 'android' | 'ios' | 'desktop';

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  // iPadOS 13+ masquerades as desktop Safari/Mac — treat touch Macs as iOS too,
  // since neither can install an APK or a desktop extension.
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document)) {
    return 'ios';
  }
  return 'desktop';
}

function detectBrowser(): { storeKey: 'chrome' | 'firefox'; label: string } {
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return { storeKey: 'firefox', label: 'Firefox' };
  if (/Edg\//.test(ua))     return { storeKey: 'chrome',  label: 'Edge' };
  if (/OPR\//.test(ua))     return { storeKey: 'chrome',  label: 'Opera' };
  if (/Chrome\//.test(ua))  return { storeKey: 'chrome',  label: 'Chrome' };
  return { storeKey: 'chrome', label: 'your browser' };
}

/** True once the Thanos extension is detected on the page (desktop only). */
function useExtensionInstalled(): boolean {
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const mark = () => { if (!cancelled) setInstalled(true); };
    if ((window as unknown as { thanos?: { isThanos?: boolean } }).thanos?.isThanos) { mark(); return; }
    const onAnnounce = (e: Event) => {
      const info = (e as CustomEvent).detail?.info;
      if (info && /thanos/i.test(`${info.name ?? ''} ${info.rdns ?? ''}`)) mark();
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce as EventListener);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    const t = setTimeout(() => {
      if ((window as unknown as { thanos?: { isThanos?: boolean } }).thanos?.isThanos) mark();
    }, 700);
    return () => {
      cancelled = true;
      window.removeEventListener('eip6963:announceProvider', onAnnounce as EventListener);
      clearTimeout(t);
    };
  }, []);
  return installed;
}

export function ExtensionPrompt() {
  const installed = useExtensionInstalled();
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [show, setShow] = useState(false);
  const [browser, setBrowser] = useState<{ storeKey: 'chrome' | 'firefox'; label: string } | null>(null);

  useEffect(() => {
    const p = detectPlatform();
    setPlatform(p);
    if (p === 'ios') return; // nothing to offer iOS yet

    const key = p === 'android' ? DISMISS_APK : DISMISS_EXT;
    let dismissed = false;
    try { dismissed = localStorage.getItem(key) === '1'; } catch { /* ignore */ }
    if (dismissed) return;

    if (p === 'desktop') setBrowser(detectBrowser());
    // Desktop waits a beat so the extension can inject + flip `installed`
    // before we bother showing the prompt; Android has nothing to wait for.
    const t = setTimeout(() => setShow(true), p === 'android' ? 700 : 1200);
    return () => clearTimeout(t);
  }, []);

  if (!show || !platform || platform === 'ios') return null;

  // ── Android → download the APK ──────────────────────────────────────────
  if (platform === 'android') {
    const dismiss = () => {
      try { localStorage.setItem(DISMISS_APK, '1'); } catch { /* ignore */ }
      setShow(false);
    };
    return (
      <div className="lp-ext-prompt" role="dialog" aria-label="Download the Thanos Wallet Android app">
        <div className="lp-ext-prompt-icon"><Smartphone size={20} /></div>
        <div className="lp-ext-prompt-text">
          <strong>Get the Thanos Wallet app</strong>
          <span>Install the Android app for the full wallet on your phone.</span>
        </div>
        <a className="lp-ext-prompt-cta" href="/download" download="thanos.apk">
          <Download size={15} style={{ marginRight: 6, verticalAlign: '-2px' }} />Download
        </a>
        <button className="lp-ext-prompt-close" onClick={dismiss} aria-label="Dismiss">
          <X size={16} />
        </button>
      </div>
    );
  }

  // ── Desktop → install the browser extension (hidden once detected) ───────
  if (installed || !browser) return null;
  const dismiss = () => {
    try { localStorage.setItem(DISMISS_EXT, '1'); } catch { /* ignore */ }
    setShow(false);
  };
  return (
    <div className="lp-ext-prompt" role="dialog" aria-label="Install the Thanos Wallet extension">
      <div className="lp-ext-prompt-icon"><Puzzle size={20} /></div>
      <div className="lp-ext-prompt-text">
        <strong>Get the Thanos Wallet extension</strong>
        <span>One-click access + dApp connect, right in {browser.label}.</span>
      </div>
      <a className="lp-ext-prompt-cta" href={STORE_URL[browser.storeKey]} target="_blank" rel="noreferrer">
        Add to {browser.label}
      </a>
      <button className="lp-ext-prompt-close" onClick={dismiss} aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>
  );
}
