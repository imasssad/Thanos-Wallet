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
  },
});
