import type { MetadataRoute } from 'next';

/**
 * Web App Manifest — makes thanos.fi installable as a native-feeling app
 * (Chrome's "Install app" prompt, Add to Home Screen on iOS/Android).
 *
 * Next serves this at /manifest.webmanifest and injects the
 * <link rel="manifest"> automatically. Combined with the service worker
 * (public/sw.js) registered in <PwaInstall/>, the install criteria are met
 * and the browser surfaces the install affordance.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Thanos Wallet',
    short_name: 'Thanos',
    description:
      'Self-custody multi-chain wallet for Lithosphere, Bitcoin & EVM. One key, every chain.',
    // Installed app opens straight into the wallet, not the marketing landing.
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#080809',
    theme_color: '#080809',
    categories: ['finance'],
    icons: [
      { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
