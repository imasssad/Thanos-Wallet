'use client';
import React, { createContext, useContext, useEffect } from 'react';
import { useTheme } from '../providers/ThemeProvider';
import { TopNav } from './TopNav';
import { OnboardingFlow, useWalletGate } from '../onboarding';
import { dualFromEvm, type DualAddress } from '../../lib/address';
import { WalletConnectHost } from '../WalletConnectHost';
import { preloadTokenLogos } from '../../lib/token-logos';

/* Wallet context — exposes the unlocked address (in both formats) AND the
   raw mnemonic words to any descendant. The mnemonic is needed only when a
   signature is required (Send tx, sign message, etc.) — never store it in
   a parent component beyond the WalletGate that decrypted it.
   Null until unlocked. */
interface WalletContextValue {
  evmAddress: string;
  addresses:  DualAddress | null;
  /** The unlocked BIP39 phrase (split into words). Empty when the wallet
   *  was imported from a raw private key — see `privateKey` below. */
  seed:       string[];
  /** Raw 0x-prefixed private key, set ONLY when the wallet was imported
   *  via private key (not derived from a mnemonic). */
  privateKey?: string;
}
const WalletContext = createContext<WalletContextValue | null>(null);
export function useWallet(): WalletContextValue | null {
  return useContext(WalletContext);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const { unlocked, hasVault, onComplete, lock, evmAddress, walletSeed, walletPrivateKey } = useWalletGate();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  /* Fire-and-forget one-time bootstrap of CoinGecko's top-250 logo map.
     TokenIcon reads the cached map synchronously after this lands. Skipped
     entirely on SSR (preloadTokenLogos guards on window). */
  useEffect(() => {
    void preloadTokenLogos();
  }, []);

  // Wait for client-side check (avoid SSR mismatch)
  if (hasVault === null) {
    return <div style={{ height: '100vh', background: 'var(--bg-base)' }}/>;
  }

  if (!unlocked) {
    return <OnboardingFlow hasVault={hasVault} onComplete={onComplete}/>;
  }

  const addresses = dualFromEvm(evmAddress);

  return (
    <WalletContext.Provider value={{ evmAddress, addresses, seed: walletSeed, privateKey: walletPrivateKey }}>
      <WalletConnectHost/>
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <TopNav onLock={lock}/>
        <main style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          {children}
        </main>
      </div>
    </WalletContext.Provider>
  );
}
