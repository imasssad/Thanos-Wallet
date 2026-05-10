'use client';
import React, { useEffect } from 'react';
import { useTheme } from '../providers/ThemeProvider';
import { TopNav } from './TopNav';
import { OnboardingFlow, useWalletGate } from '../onboarding';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const { unlocked, hasVault, onComplete, lock } = useWalletGate();

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

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopNav onLock={lock}/>
      <main style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {children}
      </main>
    </div>
  );
}
