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

/** The desktop app's version from apps/desktop/package.json, injected by
 *  vite.config.ts — what Settings → About shows. */
declare const __APP_VERSION__: string;

/** Vite's build-time env. `.DEV` is true under `vite dev` / `vite build
 *  --mode development` and false in a production `vite build`. The
 *  renderer's tsconfig doesn't pull in `vite/client`, so declare the
 *  slice we use. VITE_* values come from the build environment (or an
 *  apps/desktop/.env file) and are unset unless provided there. */
interface ImportMeta {
  readonly env: {
    readonly DEV: boolean; readonly PROD: boolean; readonly MODE: string;
    /** Etherscan API V2 key — adds BNB Chain and Linea to Activity
     *  (explorer-activity.ts). */
    readonly VITE_ETHERSCAN_API_KEY?: string;
    /** Lithic sends stay off until a transfer has been confirmed on a real
     *  build — see canSendLithic in @thanos/sdk-core. */
    readonly VITE_THANOS_LITHIC_SENDS?: string;
  };
}
