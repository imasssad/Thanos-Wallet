import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

// Bitcoin's tiny-secp256k1 imports its .wasm via the ESM Wasm integration
// proposal which Vite 5 doesn't handle by default — these two plugins make
// the renderer build succeed. Same fix as apps/extension/wxt.config.ts.
export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
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
