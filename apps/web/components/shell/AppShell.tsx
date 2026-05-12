'use client';
import React, { createContext, useContext, useEffect } from 'react';
import { useTheme } from '../providers/ThemeProvider';
import { TopNav } from './TopNav';
import { OnboardingFlow, useWalletGate } from '../onboarding';
import { dualFromEvm, type DualAddress } from '../../lib/address';

/* Wallet context — exposes the unlocked address (in both formats) to any
   descendant component (Receive view, Send view, Dashboard chip, etc.) so
   we don't have to thread props through every level. Null until unlocked. */
interface WalletContextValue {
  evmAddress: string;
  addresses:  DualAddress | null;
}
const WalletContext = createContext<WalletContextValue | null>(null);
export function useWallet(): WalletContextValue | null {
  return useContext(WalletContext);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const { unlocked, hasVault, onComplete, lock, evmAddress } = useWalletGate();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Wait for client-side check (avoid SSR mismatch)
  if (hasVault === null) {
    return <div style={{ height: '100vh', background: 'var(--bg-base)' }}/>;
  }

  if (!unlocked) {
    return <OnboardingFlow hasVault={hasVault} onComplete={onComplete}/>;
  }

  const addresses = dualFromEvm(evmAddress);

  return (
    <WalletContext.Provider value={{ evmAddress, addresses }}>
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <TopNav onLock={lock}/>
        <main style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          {children}
        </main>
      </div>
    </WalletContext.Provider>
  );
}
