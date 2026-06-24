import React from 'react';
import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '../components/providers/ThemeProvider';
import { PwaInstall } from '../components/PwaInstall';
import './globals.css';

/**
 * Explicit viewport — pins the page at fit-to-width with initial-scale 1
 * so the wallet renders at device width and never starts zoomed.
 * `viewportFit: 'cover'` lets the dark background bleed under iOS
 * notches / home indicators. Pinch-to-zoom is intentionally left
 * enabled (accessibility); the unwanted auto-zoom that used to happen
 * on input focus is killed by the >=16px form-control rule in
 * globals.css, not by disabling user scaling.
 */
export const viewport: Viewport = {
  width:        'device-width',
  initialScale: 1,
  viewportFit:  'cover',
  themeColor:   '#080809',
};

export const metadata: Metadata = {
  metadataBase: new URL('https://thanos.fi'),
  title: {
    default: 'Thanos Wallet — Web4 multi-chain wallet for Lithosphere, Bitcoin & EVM',
    template: '%s · Thanos Wallet',
  },
  description:
    'Self-custody Web4 wallet built for the Lithosphere ecosystem — LITHO, wLITHO, FGPT, BTC, ETH and more. One key, every chain: send, swap, the MultX bridge, Ignite DEX, and dApp connect via EIP-6963.',
  applicationName: 'Thanos Wallet',
  keywords: [
    'Thanos Wallet', 'Lithosphere wallet', 'Lithosphere', 'LITHO', 'wLITHO',
    'Web4 wallet', 'multi-chain wallet', 'self-custody wallet', 'non-custodial wallet',
    'crypto wallet', 'Bitcoin wallet', 'EVM wallet', 'Ethereum wallet', 'Solana wallet',
    'Makalu', 'Kamet', 'LEP100', 'MultX bridge', 'Ignite DEX', 'cross-chain bridge',
    'DeFi wallet', 'EIP-6963', 'WalletConnect', 'Sign in with Thanos',
  ],
  authors: [{ name: 'Thanos Wallet', url: 'https://thanos.fi' }],
  creator: 'Thanos Wallet',
  publisher: 'Thanos Wallet',
  category: 'finance',
  alternates: { canonical: '/' },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  openGraph: {
    type: 'website',
    url: 'https://thanos.fi',
    siteName: 'Thanos Wallet',
    title: 'Thanos Wallet — Web4 multi-chain wallet for Lithosphere, Bitcoin & EVM',
    description:
      'Self-custody Web4 wallet for the Lithosphere ecosystem. LITHO, BTC, ETH — one key, every chain. Send, swap, MultX bridge, Ignite DEX, dApp connect.',
    locale: 'en_US',
    images: [{ url: '/android-chrome-512x512.png', width: 512, height: 512, alt: 'Thanos Wallet' }],
  },
  twitter: {
    card: 'summary',
    title: 'Thanos Wallet — Web4 multi-chain wallet for Lithosphere, Bitcoin & EVM',
    description: 'Self-custody Web4 wallet for Lithosphere, Bitcoin & EVM. One key, every chain.',
    images: ['/android-chrome-512x512.png'],
  },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Thanos' },
  icons: {
    // /favicon.ico is served by the app/favicon.ico file convention; these are
    // the higher-res PNG variants + Apple/Android touch icons.
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          {children}
          <PwaInstall />
        </ThemeProvider>
      </body>
    </html>
  );
}
