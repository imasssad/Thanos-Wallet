import { defineConfig } from 'wxt';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  extensionApi: 'webextension-polyfill',
  srcDir: 'src',
  // WXT resolves `publicDir` relative to `srcDir` by default — so a bare
  // `public` would look for `src/public/`. Our static assets (manifest
  // icons + token icon pack served at `/images/tokens/`) live at
  // `apps/extension/public/`, one level up. Without this override the
  // build produces a manifest pointing at icon files that aren't in the
  // output — the Chrome Web Store rejects the zip on first upload, and
  // every token avatar in the popup falls through to its letter avatar.
  publicDir: '../public',
  // Bitcoin's tiny-secp256k1 ships a .wasm via the "ESM integration
  // proposal for Wasm" import style; Vite needs an explicit plugin to
  // load it. top-level-await covers the same library's await at module
  // top-level. Without these the popup build fails on `vite:wasm-fallback`.
  vite: () => ({
    // Browser-bundled crypto libs (bitcoinjs-lib → cipher-base →
    // readable-stream, plus WalletConnect) reference the Node globals
    // `process`, `Buffer` and `global` at MODULE-LOAD time. In a
    // chrome.action popup / offscreen page those don't exist, so the very
    // first reference — `!process.browser` in readable-stream — throws
    // `ReferenceError: process is not defined` at the TOP of the module.
    // Because the popup entry is wrapped by top-level-await, that rejection
    // freezes the whole module: createRoot AND the crash-guard watchdog
    // never run, so the popup hangs forever on the "Loading Thanos…" boot
    // fallback (and the offscreen WalletConnect host fails the same way).
    // Polyfill the three globals — CSP-safe (injected as ESM imports, no
    // inline script). We intentionally do NOT shim the global `crypto`:
    // the vault relies on the browser's native WebCrypto.
    plugins: [
      nodePolyfills({ globals: { Buffer: true, global: true, process: true }, protocolImports: true }),
      wasm(),
      topLevelAwait(),
    ],
    // NB: extension entrypoints are bundled with
    // `output.inlineDynamicImports: true` by WXT — each entrypoint
    // (popup, offscreen, background) has to ship as a single JS file
    // per the MV3 manifest rules. That makes `manualChunks`
    // incompatible at the entrypoint level (Rollup errors out).
    // Code-splitting in this app is therefore via dynamic `import()`
    // call sites only — see e.g. apps/extension/src/entrypoints/popup/
    // main.tsx where the BTC/SOL/Cosmos send paths are lazy-imported.
    // Bundle-size budget is enforced by the build's size print on
    // every CI run, not by Rollup's warning.
    build: {
      chunkSizeWarningLimit: 1000,
    },
  }),
  manifest: {
    name: 'Thanos Wallet',
    // Describes ONLY what ships. No "hardware wallet support" — there is no
    // Ledger/Trezor/HID integration in the codebase, and Chrome Web Store
    // rejects listings whose described functionality isn't present (the same
    // "functionality not working" category that bounced an earlier build).
    description: 'Lithosphere-first wallet with Bitcoin, Solana, MultX bridge, Ignite DEX, and an EIP-1193 dApp provider.',
    // 'offscreen' hosts the WalletConnect relay socket across popup
    // closes — MV3 service workers terminate after ~30s idle, which
    // kills any persistent WebSocket. Chrome-only API; gracefully
    // ignored by Firefox/Safari (which keep the popup kit fallback).
    // No 'tabs' permission: tabs.create() needs none, tabs.query({}) returns the
    // ids we use without it, and tabs.sendMessage works via host_permissions.
    // (Chrome Web Store rejected 0.2.0 for requesting 'tabs' unnecessarily.)
    permissions: ['storage', 'activeTab', 'offscreen', 'notifications'],
    host_permissions: ['https://*/*', 'http://*/*'],
    // injected.js must be loadable from page context for the MAIN-world
    // window.thanos provider injection.
    web_accessible_resources: [
      {
        matches:   ['<all_urls>'],
        resources: ['injected.js'],
      },
    ],
    // Tight CSP for extension pages (popup, offscreen, options). MV3
    // already bans `unsafe-eval` and remote script — these are explicit
    // anyway so any future relaxation requires a deliberate edit + PR
    // review. `wasm-unsafe-eval` is needed by tiny-secp256k1 (BIP32
    // derivation) which loads its WASM via the ESM integration proposal.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; base-uri 'self'; frame-ancestors 'none'",
    },
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
