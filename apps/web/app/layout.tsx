import React from 'react';
import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '../components/providers/ThemeProvider';
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
};

export const metadata: Metadata = {
  title: 'Thanos Wallet — Web4 wallet for Lithosphere, Bitcoin, EVM',
  description: 'Self-custody multi-chain wallet built for the Lithosphere ecosystem. LITHO, wLITHO, FGPT, BTC, ETH — one key, every chain.',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
    shortcut: '/favicon.ico',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
