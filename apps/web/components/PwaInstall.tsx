'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

/** Chrome's beforeinstallprompt event (not in the standard lib types). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * PWA install affordance.
 *
 * - Registers the service worker (required for the install prompt).
 * - Stashes Chrome's `beforeinstallprompt` and shows a dismissible
 *   "Install app" button; clicking it opens Chrome's NATIVE install dialog.
 * - Hidden when already installed (standalone display-mode) or dismissed.
 *
 * Chrome ALSO surfaces its own omnibox "Install" icon automatically once the
 * manifest + service worker are valid — this button is the in-page version.
 */
export function PwaInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    const dismissed = sessionStorage.getItem('thanos.pwa.dismissed') === '1';
    if (standalone || dismissed) return; // never show

    const onPrompt = (e: Event) => {
      e.preventDefault(); // suppress Chrome's auto mini-infobar — we drive it
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!visible || !deferred) return null;

  const install = async () => {
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      /* user closed the dialog — ignore */
    } finally {
      setDeferred(null);
      setVisible(false);
    }
  };

  const dismiss = () => {
    sessionStorage.setItem('thanos.pwa.dismissed', '1');
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Install Thanos Wallet"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 8px 8px 16px',
        borderRadius: 999,
        background: 'linear-gradient(135deg, #3b7af7 0%, #6366f1 100%)',
        color: '#fff',
        boxShadow: '0 12px 34px rgba(59,122,247,0.45)',
        fontWeight: 700,
        fontSize: 14,
        fontFamily: 'inherit',
      }}
    >
      <button
        onClick={install}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 9,
          background: 'none',
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
          font: 'inherit',
          padding: '2px 4px',
        }}
      >
        <Download size={18} strokeWidth={2.4} />
        Install app
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.22)',
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
        }}
      >
        <X size={14} strokeWidth={2.6} />
      </button>
    </div>
  );
}
