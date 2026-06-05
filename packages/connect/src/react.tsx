/**
 * React bindings for @thanos/connect.
 *
 * Two surfaces:
 *   • <ThanosConnectButton />   — drop-in styled connect button
 *   • useThanos(config)         — headless hook for custom UI
 *
 * Import path:
 *   import { ThanosConnectButton, useThanos } from '@thanos/connect/react';
 *
 * Both are zero-dependency outside of React (peerDep). Style the
 * button with className / inline style for tight integration with the
 * dApp's design system.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ThanosConnect,
  type ThanosConnectConfig,
  type ThanosSession,
  type DiscoveredWallet,
  SignInRejected,
  ThanosUnavailable,
} from './index.js';

/* ─── Hook ──────────────────────────────────────────────────────────── */

export interface UseThanosState {
  /** Whether the Thanos wallet is detected in this environment. */
  isAvailable: boolean | null;
  /** True while the discovery probe is in flight. */
  isProbing: boolean;
  /** True while signIn() is running. */
  isSigningIn: boolean;
  /** The session, set on successful signIn(). */
  session: ThanosSession | null;
  /** EIP-6963 metadata for the discovered wallet. */
  walletInfo: DiscoveredWallet['info'] | null;
  /** Last error from signIn() — useful for UI banners. */
  error: Error | null;
}

export interface UseThanosResult extends UseThanosState {
  signIn: (overrides?: { statement?: string; chainId?: number }) => Promise<ThanosSession>;
  signOut: () => void;
  /** Re-run discovery — useful after the user installs the extension
   *  without reloading the page. */
  refreshAvailability: () => Promise<void>;
  /** Direct access to the underlying class instance for advanced use. */
  client: ThanosConnect;
}

/**
 * Headless React hook — manages a single ThanosConnect instance and
 * exposes loading / error / session state. Re-creates the instance
 * when `appName` or `chainId` change.
 */
export function useThanos(config: ThanosConnectConfig): UseThanosResult {
  // Stable key from the config fields that should trigger a re-init.
  const key = `${config.appName}|${config.chainId ?? ''}|${config.appUrl ?? ''}|${config.walletRdns ?? ''}`;
  const clientRef = useRef<{ key: string; instance: ThanosConnect } | null>(null);
  if (!clientRef.current || clientRef.current.key !== key) {
    clientRef.current = { key, instance: new ThanosConnect(config) };
  }
  const client = clientRef.current.instance;

  const [state, setState] = useState<UseThanosState>({
    isAvailable: null,
    isProbing: false,
    isSigningIn: false,
    session: null,
    walletInfo: null,
    error: null,
  });

  const refreshAvailability = useCallback(async () => {
    setState((s) => ({ ...s, isProbing: true }));
    try {
      const available = await client.isThanosAvailable();
      setState((s) => ({
        ...s,
        isAvailable: available,
        walletInfo: client.getWalletInfo(),
        isProbing: false,
      }));
    } catch {
      setState((s) => ({ ...s, isAvailable: false, isProbing: false }));
    }
  }, [client]);

  // Probe once on mount.
  useEffect(() => {
    void refreshAvailability();
  }, [refreshAvailability]);

  const signIn = useCallback(
    async (overrides: { statement?: string; chainId?: number } = {}) => {
      setState((s) => ({ ...s, isSigningIn: true, error: null }));
      try {
        const session = await client.signIn(overrides);
        setState((s) => ({
          ...s,
          isSigningIn: false,
          session,
          walletInfo: client.getWalletInfo() ?? s.walletInfo,
        }));
        return session;
      } catch (err) {
        const e = err as Error;
        setState((s) => ({ ...s, isSigningIn: false, error: e }));
        throw e;
      }
    },
    [client],
  );

  const signOut = useCallback(() => {
    client.disconnect();
    setState((s) => ({ ...s, session: null, error: null }));
  }, [client]);

  return useMemo(
    () => ({ ...state, signIn, signOut, refreshAvailability, client }),
    [state, signIn, signOut, refreshAvailability, client],
  );
}

/* ─── Drop-in button ────────────────────────────────────────────────── */

export interface ThanosConnectButtonProps {
  /** Connector config — same as ThanosConnect's constructor. */
  config: ThanosConnectConfig;
  /** Called with the session on a successful sign-in. */
  onSignIn?: (session: ThanosSession) => void;
  /** Called when sign-in fails (rejection, network, server error). */
  onError?: (error: Error) => void;
  /** Override the displayed label. Defaults to "Sign in with Thanos". */
  label?: string;
  /** Label when the wallet isn't installed. Defaults to "Install Thanos Wallet". */
  installLabel?: string;
  /** Override the URL the install CTA opens. Defaults to https://thanos.fi/app. */
  installUrl?: string;
  /** Additional className for outer styling. */
  className?: string;
  /** Override style — wins over the built-in style. */
  style?: React.CSSProperties;
  /** Disable rendering of the built-in icon — useful when you want a
   *  text-only button or your own brand mark. */
  hideIcon?: boolean;
}

const THANOS_ICON_SVG =
  // 1024×1024 outline of a circle with the Thanos brand wordmark. Inlined
  // SVG keeps the package CSP-friendly — no external image fetches.
  // eslint-disable-next-line max-len
  '<svg width="20" height="20" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="46" fill="#3b7af7"/><text x="50" y="65" font-family="-apple-system,Inter,Arial,sans-serif" font-size="42" font-weight="800" fill="white" text-anchor="middle">T</text></svg>';

const DEFAULT_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 16px',
  borderRadius: 10,
  border: 'none',
  background: 'linear-gradient(135deg, #3b7af7 0%, #6366f1 100%)',
  color: '#fff',
  fontFamily: '-apple-system, BlinkMacSystemFont, Inter, Segoe UI, Arial, sans-serif',
  fontWeight: 700,
  fontSize: 14,
  cursor: 'pointer',
  transition: 'transform 0.12s, opacity 0.12s',
};

const DISABLED_STYLE: React.CSSProperties = {
  cursor: 'not-allowed',
  opacity: 0.7,
};

const DEFAULT_INSTALL_URL = 'https://thanos.fi/app';

/**
 * Drop-in "Sign in with Thanos" button.
 *
 * • Probes availability on mount and renders an install-CTA when the
 *   wallet isn't found.
 * • Disables itself while signing in.
 * • Calls onSignIn / onError; doesn't manage its own session UI —
 *   the dApp's auth context handles that.
 */
export function ThanosConnectButton({
  config,
  onSignIn,
  onError,
  label = 'Sign in with Thanos',
  installLabel = 'Install Thanos Wallet',
  installUrl = DEFAULT_INSTALL_URL,
  className,
  style,
  hideIcon,
}: ThanosConnectButtonProps) {
  const t = useThanos(config);

  const handleClick = useCallback(async () => {
    if (t.isAvailable === false) {
      if (typeof window !== 'undefined') window.open(installUrl, '_blank', 'noopener');
      return;
    }
    try {
      const session = await t.signIn();
      onSignIn?.(session);
    } catch (err) {
      const e = err as Error;
      // We deliberately don't surface SignInRejected as a hard error —
      // user-initiated cancels are normal UX. Pass it on for dApps that
      // want to track it; default no-op.
      if (!(e instanceof SignInRejected)) onError?.(e);
      else onError?.(e);
    }
  }, [t, onSignIn, onError, installUrl]);

  const isLoading = t.isProbing || t.isSigningIn;
  const isInstallCTA = t.isAvailable === false;
  const displayLabel = isInstallCTA
    ? installLabel
    : t.isSigningIn
      ? 'Signing in…'
      : label;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isLoading}
      className={className}
      style={{
        ...DEFAULT_STYLE,
        ...(isLoading ? DISABLED_STYLE : null),
        ...style,
      }}
      data-thanos-connect="button"
      aria-label={displayLabel}
    >
      {!hideIcon && (
        <span
          aria-hidden
          style={{ display: 'inline-flex' }}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: THANOS_ICON_SVG }}
        />
      )}
      <span>{displayLabel}</span>
    </button>
  );
}

/* Re-export the underlying types so dApps don't need two imports. */
export { ThanosConnect, ThanosUnavailable, SignInRejected };
export type { ThanosConnectConfig, ThanosSession, DiscoveredWallet };
