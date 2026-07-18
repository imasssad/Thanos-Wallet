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
