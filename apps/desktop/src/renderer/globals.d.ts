/**
 * Ambient build-time constants for the desktop renderer.
 *
 * __MAS_BUILD__ is injected by vite.config.ts (`define`) from the MAS_BUILD env
 * var. It is `true` only in the sandboxed Mac App Store build, where the
 * hardware-wallet UI and self-updater must be absent (App Store requirements).
 * The direct-download (.dmg / .exe) build keeps everything, with __MAS_BUILD__
 * `false`.
 */
declare const __MAS_BUILD__: boolean;

/** Vite's build-time env. `.DEV` is true under `vite dev` / `vite build
 *  --mode development` and false in a production `vite build`. The
 *  renderer's tsconfig doesn't pull in `vite/client`, so declare the
 *  slice we use. */
interface ImportMeta {
  readonly env: { readonly DEV: boolean; readonly PROD: boolean; readonly MODE: string };
}
