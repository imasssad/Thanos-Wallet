'use client';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { HDNodeWallet, Mnemonic } from 'ethers';
import { useTheme } from '../providers/ThemeProvider';
import { TopNav } from './TopNav';
import { BottomNav } from './BottomNav';
import { OnboardingFlow, useWalletGate } from '../onboarding';
import { dualFromEvm, type DualAddress } from '../../lib/address';
import { WalletConnectHost } from '../WalletConnectHost';
import { AddNetworkNudge, MakaluWelcomeCard } from '../MakaluNetworkPrompt';
import { preloadTokenLogos } from '../../lib/token-logos';
import { setContactEncryptionKey } from '../../lib/contact-crypto';
import {
  getActiveAccountIndex, setActiveAccountIndex,
  getAccountCount, setAccountCount, MAX_ACCOUNTS,
} from '../../lib/vault';
import { discoverFundedAccountCount, deriveAccountAddresses } from '../../lib/account-discovery';
import { setSignerAccountIndex } from '../../lib/signer-client';
import { initDisplayCurrency, subscribeFx } from '@thanos/sdk-core';

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

  // Display-currency boot + live updates. Prices are held in USD internally and
  // converted at FORMAT time, so a currency change only needs the tree to
  // re-render — this tick does that. Without it the Settings picker would
  // change the stored preference but leave every on-screen figure stale.
  const [, setFxTick] = useState(0);
  useEffect(() => {
    void initDisplayCurrency().then(() => setFxTick(t => t + 1));
    return subscribeFx(() => setFxTick(t => t + 1));
  }, []);

  // Multi-account state. activeIdx is the HD-path the wallet derives
  // from; accountCount is how many "Account N" rows we expose in the
  // TopNav switcher. Mnemonic-only — privateKey-imported wallets are
  // single-account by definition.
  const isMnemonicWallet = walletSeed.length > 0 && !walletPrivateKey;
  const [activeIdx, setActiveIdx]       = useState(0);
  const [accountCount, setAccountCountState] = useState(1);
  useEffect(() => {
    if (!unlocked) return;
    setActiveIdx(getActiveAccountIndex());
    setAccountCountState(getAccountCount());
  }, [unlocked]);

  // Re-derive the EVM address from the unlocked seed at activeIdx.
  // For PK-only wallets the upstream evmAddress is authoritative.
  const derivedEvm = useMemo(() => {
    if (!isMnemonicWallet) return evmAddress;
    try {
      const m  = Mnemonic.fromPhrase(walletSeed.join(' '));
      const hd = HDNodeWallet.fromMnemonic(m, `m/44'/60'/0'/0/${activeIdx}`);
      return hd.address;
    } catch { return evmAddress; }
  }, [isMnemonicWallet, walletSeed, activeIdx, evmAddress]);

  // Push the active index into the signer worker so the next signed
  // tx broadcasts from the displayed account.
  useEffect(() => {
    if (!unlocked || !isMnemonicWallet) return;
    void setSignerAccountIndex(activeIdx).catch(() => { /* worker not ready yet */ });
  }, [activeIdx, unlocked, isMnemonicWallet]);

  // Account discovery — scan HD indices for funded accounts so a deposit made
  // to a non-active index (or any account on a freshly imported wallet) becomes
  // reachable in the switcher instead of being invisible. Runs once per unlock;
  // only ever GROWS accountCount, never hides an account the user already has.
  useEffect(() => {
    if (!unlocked || !isMnemonicWallet || walletSeed.length === 0) return;
    let cancel = false;
    void discoverFundedAccountCount(walletSeed)
      .then((n) => {
        if (cancel) return;
        if (n > getAccountCount()) { setAccountCount(n); setAccountCountState(n); }
      })
      .catch(() => { /* best-effort */ });
    return () => { cancel = true; };
  }, [unlocked, isMnemonicWallet, walletSeed]);

  // Per-account EVM addresses for the switcher (so users can identify which
  // numbered account is which, rather than a bare "Account N").
  const accountAddresses = useMemo(
    () => (isMnemonicWallet ? deriveAccountAddresses(walletSeed, accountCount) : []),
    [isMnemonicWallet, walletSeed, accountCount],
  );

  const switchAccount = (idx: number) => {
    if (idx < 0 || idx >= accountCount) return;
    setActiveAccountIndex(idx);
    setActiveIdx(idx);
  };
  const addAccount = () => {
    if (accountCount >= MAX_ACCOUNTS) return;
    const next = accountCount;
    setAccountCount(next + 1);
    setAccountCountState(next + 1);
    setActiveAccountIndex(next);
    setActiveIdx(next);
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  /* Fire-and-forget one-time bootstrap of CoinGecko's top-250 logo map.
     TokenIcon reads the cached map synchronously after this lands. Skipped
     entirely on SSR (preloadTokenLogos guards on window). */
  useEffect(() => {
    void preloadTokenLogos();
  }, []);

  /* Derive + cache the contact-encryption key from the unlocked seed.
     Cleared when the wallet locks (walletSeed goes empty). The address
     book uses this to encrypt name + notes before POSTing to /contacts. */
  useEffect(() => {
    void setContactEncryptionKey(unlocked ? walletSeed : null);
    return () => { void setContactEncryptionKey(null); };
  }, [unlocked, walletSeed]);

  // Wait for client-side check (avoid SSR mismatch)
  if (hasVault === null) {
    return <div className="app-shell" style={{ background: 'var(--bg-base)' }}/>;
  }

  if (!unlocked) {
    return <OnboardingFlow hasVault={hasVault} onComplete={onComplete}/>;
  }

  const addresses = dualFromEvm(derivedEvm);

  return (
    <WalletContext.Provider value={{ evmAddress: derivedEvm, addresses, seed: walletSeed, privateKey: walletPrivateKey }}>
      <WalletConnectHost/>
      {/* First-run Lithosphere Makalu prompts — both self-gate via
          localStorage, so they appear at most once per browser. The welcome
          card introduces the home network; the nudge offers to add Makalu to
          an external injected wallet (MetaMask etc.) if one is present. */}
      <MakaluWelcomeCard/>
      <AddNetworkNudge/>
      {/* Height lives in globals.css (.app-shell): 100dvh — not 100vh —
          so iOS Safari's collapsing URL bar can't strand content below
          the fold, and divided by the desktop zoom factor so the zoomed
          shell still fits the real viewport exactly. This was the
          "Discover page sometimes can't scroll" bug. */}
      <div className="app-shell" style={{ display: 'flex', flexDirection: 'column' }}>
        <TopNav
          onLock={lock}
          activeIdx={activeIdx}
          accountCount={isMnemonicWallet ? accountCount : 1}
          accountAddresses={accountAddresses}
          onSwitchAccount={isMnemonicWallet ? switchAccount  : undefined}
          onAddAccount={isMnemonicWallet ? addAccount : undefined}
        />
        <main style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          {children}
        </main>
        <BottomNav/>
      </div>
    </WalletContext.Provider>
  );
}
