'use client';

import React, { useEffect, useState } from 'react';
import { Puzzle, X } from 'lucide-react';

/**
 * "Get the extension" banner for thanos.fi visitors.
 *
 * Rules:
 *  - Desktop only (browser extensions don't apply to mobile).
 *  - Hidden if the Thanos extension is already installed — detected via the
 *    `window.thanos.isThanos` marker it injects, plus an EIP-6963
 *    request/announce handshake (see apps/extension/src/entrypoints/injected.ts).
 *  - Dismissible; the choice is remembered in localStorage so it doesn't nag.
 *  - Browser-aware CTA (Chrome/Edge/Opera → Chrome Web Store, Firefox → AMO).
 *
 * TODO: STORE_URL points at each store's search for "Thanos Wallet" until the
 * listings are published — swap in the real listing URLs when they go live.
 */

const DISMISS_KEY = 'thanos_ext_prompt_dismissed';

const STORE_URL: Record<'chrome' | 'firefox', string> = {
  chrome:  'https://chromewebstore.google.com/search/Thanos%20Wallet',
  firefox: 'https://addons.mozilla.org/firefox/search/?q=Thanos%20Wallet',
};

function detectBrowser(): { storeKey: 'chrome' | 'firefox'; label: string } {
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return { storeKey: 'firefox', label: 'Firefox' };
  if (/Edg\//.test(ua))     return { storeKey: 'chrome',  label: 'Edge' };
  if (/OPR\//.test(ua))     return { storeKey: 'chrome',  label: 'Opera' };
  if (/Chrome\//.test(ua))  return { storeKey: 'chrome',  label: 'Chrome' };
  return { storeKey: 'chrome', label: 'your browser' };
}

/** True once the Thanos extension is detected on the page. */
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
    // Re-check the marker shortly after, in case injection hadn't run yet.
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
  const [show, setShow] = useState(false);
  const [browser, setBrowser] = useState<{ storeKey: 'chrome' | 'firefox'; label: string } | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    let dismissed = false;
    try { dismissed = localStorage.getItem(DISMISS_KEY) === '1'; } catch { /* ignore */ }
    if (isMobile || dismissed) return;
    setBrowser(detectBrowser());
    // Give the extension a beat to inject (and flip `installed`) before showing.
    const t = setTimeout(() => setShow(true), 1200);
    return () => clearTimeout(t);
  }, []);

  if (!show || installed || !browser) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
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
