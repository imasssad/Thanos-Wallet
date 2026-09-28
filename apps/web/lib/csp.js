/* Content-Security-Policy for the web app — one allow-list, two deliveries:
 *
 *  - The wallet (/app/*) gets a fresh per-request nonce from middleware.ts:
 *    script-src 'nonce-…' 'strict-dynamic', no 'unsafe-inline', so an
 *    HTML-injection bug in the wallet can't become script execution (audit
 *    H-2). Next adds the nonce to its own bootstrap / flight-data scripts;
 *    'strict-dynamic' lets those load the chunks they need.
 *  - Every other page (landing, docs, legal) is statically pre-rendered and
 *    shared-cached (next.config.js headers), so it can't carry a
 *    per-request nonce and keeps 'unsafe-inline' for Next's inline scripts.
 *    Those pages hold no keys, and links into the wallet are full page
 *    loads, so the wallet never runs under this policy.
 *
 * Tight allow-list: only domains we actually call. Edit when adding a new
 * upstream (e.g. a new RPC, a new bridge).
 *
 *  - 'wasm-unsafe-eval' lets tiny-secp256k1, hash-wasm + WalletConnect's
 *    crypto load their .wasm modules. No 'unsafe-eval': the bundle's only
 *    Function()/eval sites are guarded fallbacks.
 *  - connect-src includes RPC, indexer, bridge, CoinGecko, Reown, Sentry.
 *  - img-src includes the CoinGecko CDN we use for live token logos.
 *  - style-src / font-src allow Google Fonts (globals.css @imports Geist).
 *  - frame-ancestors 'none' prevents clickjacking of the wallet inside an
 *    <iframe>.
 *
 * CommonJS so next.config.js can require() it; middleware.ts imports it.
 */

/** @param {string} [nonce] per-request script nonce (the wallet); omit for the static policy */
function buildCsp(nonce) {
  return [
    "default-src 'self'",
    nonce
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'`
      : "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    // qr-scanner decodes in a Worker it spawns from a blob: URL (its own bundled
    // code, see createObjectURL in qr-scanner.umd.min.js). With default-src 'self'
    // and no worker-src, that worker is BLOCKED — so the camera opens but the QR
    // never decodes and the scan just times out. Allow same-origin + blob:
    // workers (child-src is the fallback older Safari consults for workers).
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src 'self' https://widget.lax.money https://checkout.lax.money",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob:"
      // CoinGecko serves token logos from BOTH hosts — /coins/markets returns
      // coin-images.coingecko.com URLs (verified live 2026-06-11).
      + " https://assets.coingecko.com"
      + " https://coin-images.coingecko.com"
      + " https://raw.githubusercontent.com"
      + " https://dl.dropboxusercontent.com"
      + " https://www.dropbox.com"
      + " https://makalu.litho.ai"
      + " https://explorer.solana.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self'"
      // Lithosphere RPCs. Makalu: rpc.litho.ai / rpc-2. Kamet: rpc-3 (REST
      // api-3). rpc-3 sends no CORS headers, so browser Kamet traffic goes
      // through the same-origin proxy (/rpc/kamet, 'self') — rpc-3 is listed
      // only for the server-side proxy target + any direct server callers.
      + " https://rpc.litho.ai https://rpc-2.litho.ai https://rpc-3.litho.ai https://api-3.litho.ai"
      + " https://bridge.litho.ai"
      + " https://ignite.trade"
      // Quantt AI agents — native wallet sign-in + /v1/mobile BFF. api.quantts.ai
      // returns CORS for https://thanos.fi, so the browser calls it directly.
      + " https://api.quantts.ai"
      + " https://api.coingecko.com"
      // Display-currency FX rates (sdk-core/fx.ts → USD→EUR/GBP/JPY/BTC).
      // WITHOUT this the browser blocks the rate fetch, the engine falls back to
      // USD exactly as designed ("never show wrong math"), and the Settings
      // Currency picker silently appears to do nothing. The native apps have no
      // CSP, which is why this only ever broke on web.
      + " https://api.coinbase.com"
      // Multi-chain balance/send upstreams the lib/ clients actually call.
      + " https://mempool.space"
      + " https://api.mainnet-beta.solana.com"
      + " https://cosmos-rpc.publicnode.com https://cosmos-rest.publicnode.com"
      + " https://ethereum.publicnode.com https://eth.merkle.io"
      + " https://bsc-dataseed.binance.org"
      + " https://polygon-bor-rpc.publicnode.com https://api.avax.network"
      + " https://arb1.arbitrum.io https://mainnet.optimism.io https://mainnet.base.org https://rpc.linea.build"
      + " https://relay.walletconnect.com wss://relay.walletconnect.com wss://relay.walletconnect.org"
      + " https://*.sentry.io"
      + " https://thanos.fi",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

module.exports = { buildCsp };
