/**
 * In-app dApp browser overlay — desktop only.
 *
 * Renders the chrome (back / forward / reload / URL bar / open-in-default /
 * close) at the top of the window; the actual web content is a
 * WebContentsView managed by the main process (see src/main/dapp-browser.ts)
 * that sits underneath this chrome.
 *
 * Sizing model: the chrome is a fixed-height bar pinned to the top. The
 * BrowserView occupies the rest of the window down to the bottom. We
 * recompute and push bounds on every window resize and on mount.
 *
 * Why a portal-style fixed overlay (not a normal flex child): the
 * WebContentsView in main sits on top of the React DOM regardless of
 * z-index, so the entire wallet UI underneath is effectively covered.
 * Drawing the chrome with `position: fixed` means it overlays the
 * wallet UI consistently, so back-from-dApp returns to whatever view
 * was active.
 */
import React, { useEffect, useRef, useState } from 'react';

const CHROME_HEIGHT = 52;

type Bridge = NonNullable<typeof window.thanosDesktop>['dapp'];

function getBridge(): Bridge | null {
  return window.thanosDesktop?.dapp ?? null;
}

function computeBounds(): { x: number; y: number; width: number; height: number } {
  return {
    x:      0,
    y:      CHROME_HEIGHT,
    width:  window.innerWidth,
    height: Math.max(0, window.innerHeight - CHROME_HEIGHT),
  };
}

export function DappBrowserOverlay({ onClose, initialUrl, initialTitle }: {
  onClose: () => void;
  initialUrl:   string;
  initialTitle: string;
}) {
  const bridge = getBridge();
  const [url,   setUrl]   = useState(initialUrl);
  const [title, setTitle] = useState(initialTitle);
  const [loading, setLoading]           = useState(true);
  const [canBack, setCanBack]           = useState(false);
  const [canForward, setCanForward]     = useState(false);
  const [urlInput, setUrlInput] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // Mount the BrowserView the first time the overlay renders, and
  // re-push its bounds on every window resize. Cleanup tears it down.
  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void bridge.open(initialUrl, computeBounds()).then(r => {
      if (cancelled) return;
      if (!r.ok) setError(r.error || 'Could not open this dApp.');
    });
    const onResize = () => { void bridge.setBounds(computeBounds()); };
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      // The unmount path is only hit when the overlay closes, so tearing
      // down the view here is correct.
      void bridge.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stream navigation events from the WebContentsView so the URL bar /
  // back-forward / spinner stay synced with the actual page.
  useEffect(() => {
    if (!bridge?.onEvent) return;
    const off = bridge.onEvent((ev) => {
      switch (ev.kind) {
        case 'loading-start': setLoading(true); setError(null); break;
        case 'loading-stop':  setLoading(false); break;
        case 'did-navigate':
        case 'did-navigate-in-page':
          if (ev.url) { setUrl(ev.url); setUrlInput(ev.url); }
          if (typeof ev.canGoBack    === 'boolean') setCanBack(ev.canGoBack);
          if (typeof ev.canGoForward === 'boolean') setCanForward(ev.canGoForward);
          break;
        case 'title':
          if (ev.title) setTitle(ev.title);
          break;
        case 'load-fail':
          setLoading(false);
          setError(ev.description ? `Failed to load: ${ev.description}` : 'Failed to load this page.');
          break;
      }
    });
    return off;
  }, [bridge]);

  const submitUrl = () => {
    if (!bridge) return;
    const raw = urlInput.trim();
    if (!raw) return;
    const normalised = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    void bridge.navigate(normalised);
  };

  const host = (() => {
    try { return new URL(url).host; } catch { return ''; }
  })();

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        // Transparent except for the chrome strip — the rest of the area
        // is "occupied" by the underlying WebContentsView, and pointer
        // events must NOT be captured by this container or the dApp can't
        // receive clicks. The chrome itself has pointer-events: auto.
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      {/* Chrome — fixed height at the top of the window. */}
      <div
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: CHROME_HEIGHT,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 12px',
          background: 'var(--bg-card, #14141a)',
          borderBottom: '1px solid var(--border-default, #1f1f27)',
          color: 'var(--text-primary, #e5e7eb)',
          fontSize: 12,
          pointerEvents: 'auto',
        }}
      >
        {/* Back / Forward / Reload */}
        <NavBtn label="←" disabled={!canBack}    onClick={() => bridge?.back()}/>
        <NavBtn label="→" disabled={!canForward} onClick={() => bridge?.forward()}/>
        <NavBtn label="⟳" onClick={() => bridge?.reload()}/>

        {/* URL bar — read-only display + edit-on-focus */}
        <form
          onSubmit={(e) => { e.preventDefault(); submitUrl(); }}
          style={{ flex: 1, display: 'flex', alignItems: 'center', minWidth: 0 }}
        >
          <input
            ref={urlInputRef}
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              flex: 1, minWidth: 0,
              padding: '7px 12px',
              borderRadius: 999,
              background: 'var(--bg-elevated, #1c1c24)',
              border: '1px solid var(--border-subtle, #232330)',
              color: 'var(--text-primary, #e5e7eb)',
              fontSize: 12,
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
        </form>

        {/* Title + host pill — purely informational */}
        <div
          style={{
            fontSize: 11, color: 'var(--text-muted, #8b8d99)',
            maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
          title={title}
        >
          {host ? `${title || host} · ${host}` : title}
        </div>

        {/* Open in default browser */}
        <button
          type="button"
          onClick={() => { void window.thanosDesktop?.openExternal?.(url); }}
          title="Open in default browser"
          style={chromeBtnStyle}
        >
          ↗
        </button>

        {/* Close — returns to the wallet view that was behind us */}
        <button
          type="button"
          onClick={onClose}
          title="Close"
          style={{ ...chromeBtnStyle, background: 'var(--bg-elevated, #1c1c24)' }}
        >
          ✕
        </button>

        {/* Loading hairline at the very bottom of the chrome */}
        {loading && (
          <div
            style={{
              position: 'absolute', left: 0, right: 0, bottom: 0, height: 2,
              background: 'linear-gradient(90deg, transparent, var(--blue, #3b7af7), transparent)',
              backgroundSize: '200% 100%',
              animation: 'dapp-loading-bar 1.2s linear infinite',
            }}
          />
        )}
      </div>

      {/* Inline error banner — overlays just below the chrome, dismissable */}
      {error && (
        <div
          style={{
            position: 'absolute', left: 12, right: 12, top: CHROME_HEIGHT + 8,
            padding: '8px 12px', borderRadius: 8,
            background: 'rgba(239,68,68,0.10)', color: 'var(--red, #f87171)',
            border: '1px solid rgba(239,68,68,0.30)',
            fontSize: 12,
            pointerEvents: 'auto',
          }}
        >
          {error}
        </div>
      )}

      {/* Keyframes for the loading bar — Vite scopes nothing, so a single
          style tag is the lightest way to ship this without adding to
          the main stylesheet. */}
      <style>{`@keyframes dapp-loading-bar { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }`}</style>
    </div>
  );
}

const chromeBtnStyle: React.CSSProperties = {
  width: 28, height: 28,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 8,
  border: '1px solid var(--border-subtle, #232330)',
  background: 'transparent',
  color: 'var(--text-primary, #e5e7eb)',
  cursor: 'pointer',
  fontSize: 14,
  fontFamily: 'inherit',
};

function NavBtn({ label, onClick, disabled }: { label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...chromeBtnStyle,
        opacity: disabled ? 0.35 : 1,
        cursor:  disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}
