import { defineConfig } from 'tsup';

// Dual-format build (ESM + CJS) so this works from either a Vite/Next
// frontend (Ignite, MagmaDEX) or a Node backend/agent runtime (Quantts).
// `ethers` is a peer dep, kept external — partner apps already carry it and
// we never want two copies of a wallet-signing library in one bundle.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: ['ethers'],
});
