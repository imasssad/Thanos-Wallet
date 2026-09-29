import { readFileSync } from 'fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

/* Content-Security-Policy for the packaged renderer (audit M-8). Scripts
   only from the app bundle — no inline or remote script, no eval — so an
   injection in the UI can't run code; 'wasm-unsafe-eval' for the WebAssembly
   crypto (tiny-secp256k1, argon2). Styles keep 'unsafe-inline' (React style
   props, library-injected <style>). Network: any https/wss endpoint, since
   users can add custom RPCs. Build only: Vite's dev server injects inline
   scripts for HMR. */
const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  // Google Fonts: styles.css @imports the Geist family.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "frame-src https:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// The app's own version (package.json) for Settings → About.
const APP_VERSION = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

// Bitcoin's tiny-secp256k1 imports its .wasm via the ESM Wasm integration
// proposal which Vite 5 doesn't handle by default — these two plugins make
// the renderer build succeed. Same fix as apps/extension/wxt.config.ts.
export default defineConfig({
  // The packaged app loads the renderer via win.loadFile(index.html) → a
  // file:// URL, where an ABSOLUTE '/assets/…' or '/images/…' path resolves to
  // the filesystem/drive root (file:///C:/…) and 404s — leaving a blank window
  // and no icons. Relative base makes Vite emit './assets/…' so everything
  // resolves against dist/. Still correct in dev (Vite serves it fine).
  base: './',
  // Compile-time flag for the Mac App Store build (`MAS_BUILD=1 pnpm build`):
  // the sandbox blocks USB/HID, so the hardware-wallet UI is stripped, and the
  // self-updater is banned. Replaced literally, so the gated UI is dead-code-
  // eliminated in the MAS bundle (and left intact in the direct-download build).
  define: {
    __MAS_BUILD__: JSON.stringify(process.env.MAS_BUILD === '1'),
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [
    {
      name: 'thanos-renderer-csp',
      apply: 'build',
      transformIndexHtml: (html: string) => html.replace(
        '<meta charset="utf-8" />',
        `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${RENDERER_CSP}" />`,
      ),
    },
    react(),
    // Electron 33 SANDBOXES the renderer (no Node globals) and Vite externalizes
    // node builtins in dev — so bundled crypto libs throw "process is not
    // defined" and the window goes blank. Polyfill process / Buffer / global
    // (same fix as apps/extension). CSP-safe; global `crypto` stays WebCrypto.
    nodePolyfills({ globals: { Buffer: true, global: true, process: true }, protocolImports: true }),
    wasm(),
    topLevelAwait(),
  ],
  build: {
    // tsc -p tsconfig.main.json runs FIRST and writes dist/index.js (the
    // Electron main-process entry). Vite would otherwise wipe dist/ before
    // building the renderer and the packaged app would have no main entry.
    emptyOutDir: false,

    // Code-split the renderer into deps-aligned vendor chunks. Without
    // this, Rollup throws every workspace dep into a single 3-4 MB
    // index-*.js bundle and we get the "chunks larger than 500 kB"
    // warning on every build. The split also helps cold-start time:
    // the user-facing entry chunk lands first, the chain libs land
    // when the user opens the BTC/SOL/Cosmos sends.
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          if (
            id.includes('bitcoinjs-lib') ||
            id.includes('tiny-secp256k1') ||
            id.includes('ecpair') ||
            id.includes('/bip32/') ||
            id.includes('/bip39/')
          ) return 'vendor-bitcoin';
          if (id.includes('@solana'))                                  return 'vendor-solana';
          if (id.includes('@cosmjs'))                                  return 'vendor-cosmos';
          if (id.includes('@walletconnect') || id.includes('@reown'))  return 'vendor-walletconnect';
          if (id.includes('@ledgerhq')   || id.includes('@trezor'))    return 'vendor-hardware';
          if (id.includes('/ethers/'))                                 return 'vendor-ethers';
          if (id.includes('qrcode'))                                   return 'vendor-qrcode';
          // Everything else from node_modules — keeps the entry chunk small.
          return 'vendor';
        },
      },
    },

    // We've split — anything still tripping the warning is a real signal
    // worth investigating.
    chunkSizeWarningLimit: 1000,
  },
});
