import { defineConfig } from 'wxt';

export default defineConfig({
  extensionApi: 'webextension-polyfill',
  srcDir: 'src',
  manifest: {
    name: 'Thanos Wallet',
    description: 'Lithosphere-first wallet with Bitcoin, Solana, MultX, Ignite DEX, and hardware wallet support.',
    permissions: ['storage', 'activeTab', 'tabs'],
    host_permissions: ['https://*/*', 'http://*/*'],
    // injected.js must be loadable from page context for the MAIN-world
    // window.thanos provider injection.
    web_accessible_resources: [
      {
        matches:   ['<all_urls>'],
        resources: ['injected.js'],
      },
    ],
    icons: {
      '16':  'icons/icon16.png',
      '32':  'icons/icon32.png',
      '128': 'icons/icon128.png',
      '512': 'icons/icon512.png',
    },
    action: {
      default_title: 'Thanos Wallet',
      default_icon: {
        '16':  'icons/icon16.png',
        '32':  'icons/icon32.png',
        '128': 'icons/icon128.png',
      },
    },
  }
});
