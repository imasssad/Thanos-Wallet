/*
 * Classic (non-module) boot guard for the Thanos popup / offscreen page.
 * Loaded from popup.html BEFORE the ES-module entry.
 *
 * WHY THIS EXISTS
 * The entry module is wrapped by vite-plugin-top-level-await, so a throw at
 * its module top — e.g. a bundled crypto lib (bitcoinjs-lib -> cipher-base ->
 * readable-stream, WalletConnect) touching a Node global that isn't defined —
 * aborts the WHOLE module before React mounts and before the in-module crash
 * guards/watchdog can register. The popup then sits forever on the
 * "Loading Thanos…" fallback with no message in the UI.
 *
 * Being a CLASSIC script, this runs synchronously during head parse, ahead of
 * the deferred module, and is itself immune to that freeze. It does two jobs:
 *
 *   1. Define the Node globals those libs read at load time. The build's
 *      node-polyfills plugin rewrites *free* `process`/`Buffer` identifiers to
 *      shim imports, but the CJS-interop code reads them as `commonjsGlobal.X`
 *      (= globalThis.X), which the plugin does NOT set — so we set them here.
 *      (Buffer needs a real implementation and is provided by the plugin's
 *      per-module shim at call sites; process/global are what break at eval.)
 *
 *   2. Register global error / unhandledrejection handlers that paint the real
 *      error into #root, turning a silent hang into an on-screen diagnostic.
 */
(function () {
  var g = (typeof globalThis !== 'undefined') ? globalThis : (typeof self !== 'undefined' ? self : this);

  if (!g.global) { g.global = g; }

  if (!g.process) {
    g.process = {
      env: {}, argv: [], browser: true, version: '', versions: {},
      platform: 'browser', title: 'browser',
      nextTick: function (fn) {
        var args = Array.prototype.slice.call(arguments, 1);
        Promise.resolve().then(function () { fn.apply(null, args); });
      },
      cwd: function () { return '/'; },
      on: function () {}, once: function () {}, off: function () {},
      emit: function () {}, addListener: function () {}, removeListener: function () {},
    };
  }

  // ── on-screen error reporter ───────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
    });
  }
  var ver = '';
  try { ver = (g.chrome && chrome.runtime && chrome.runtime.getManifest().version) || ''; } catch (e) { /* noop */ }

  var painted = false;
  function paint(kind, msg, stack) {
    if (painted) return; painted = true;            // first error only
    try {
      var root = document.getElementById('root');
      if (!root) return;
      root.innerHTML =
        '<div style="display:flex;flex-direction:column;gap:8px;padding:16px;width:360px;' +
        'min-height:600px;box-sizing:border-box;background:#080809;color:#e6e6ea;overflow:auto;' +
        "font:12px ui-monospace,Menlo,Consolas,monospace;\">" +
        '<div style="font-weight:700;color:#ff6b6b;font-size:13px;">Popup failed to start' +
        (ver ? ' (v' + esc(ver) + ')' : '') + '</div>' +
        '<div style="color:#9a9aa5;">' + esc(kind) + '</div>' +
        '<div style="white-space:pre-wrap;word-break:break-word;color:#ffd0d0;">' + esc(msg) + '</div>' +
        '<div style="white-space:pre-wrap;word-break:break-word;color:#71717a;font-size:11px;">' +
        esc(stack || '') + '</div>' +
        '</div>';
    } catch (e) { /* noop */ }
  }

  g.addEventListener('error', function (e) {
    paint('error', (e && e.message) || 'unknown error', e && e.error && e.error.stack);
  });
  g.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    paint('unhandledrejection', (r && (r.message || r)) || 'unknown rejection', r && r.stack);
  });
})();
