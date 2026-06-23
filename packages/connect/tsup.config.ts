import { defineConfig } from 'tsup';

// Dual-format build so `thanos-connect` works for BOTH module systems:
//  - ESM consumers (Vite/Next/webpack, the explorer's frontend)  -> dist/*.js
//  - CommonJS consumers (a Node backend that `require()`s the SIWE
//    verifier server-side)                                        -> dist/*.cjs
// Types are emitted per entry. `react` is a peer dep, kept external so
// the SDK never bundles a copy of React.
export default defineConfig({
  entry: ['src/index.ts', 'src/react.tsx'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: ['react'],
});
