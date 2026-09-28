# Transaction-signing isolation across surfaces

**Current state (2026-09-28): partial.** Each client has a signing component
outside its main UI code — a Web Worker, the MV3 offscreen document, the
Electron main process, a module-scope signer on mobile. But on every client
the UI **also** decrypts the vault and holds the seed while the wallet is
unlocked, and hands it to that component. The components are copies, not
boundaries: script running in the wallet UI (an XSS, a compromised
dependency) can read the seed from UI state today. This was finding H-1 of
`docs/audit/2026-09-27/HARDENING-AUDIT.md`, and it is still open.

An earlier version of this page described each component as the only place
the secret lives. That was never true of the code; don't rely on it.

## Map

| Surface | Signing component | Where the seed is while unlocked | What signs where |
|---------|-------------------|----------------------------------|------------------|
| **Web app** | Dedicated Worker, [`apps/web/workers/signer-worker.ts`](../apps/web/workers/signer-worker.ts), which receives the seed on `init` | React state in `useWalletGate` (`walletSeed`, `walletPrivateKey` — [`components/onboarding.tsx`](../apps/web/components/onboarding.tsx)), plus the worker's copy | EVM Send, WalletConnect and Quantt sign in the worker (WalletConnect falls back to the page while the worker starts); other chains sign in the page |
| **Browser extension** | MV3 offscreen document, [`entrypoints/offscreen/main.ts`](../apps/extension/src/entrypoints/offscreen/main.ts) | Popup state (`WalletSeedContext`); the seed crosses to the offscreen document with every signing call ([`popup/offscreen-sign.ts`](../apps/extension/src/entrypoints/popup/offscreen-sign.ts)) | Derived keys exist only in the offscreen document; the seed is in both |
| **Desktop (Electron)** | Main-process signer, [`src/main/signer.ts`](../apps/desktop/src/main/signer.ts), over `signer:*` IPC that only the app's own top frame may call | The renderer decrypts the vault ([`renderer/vault.ts`](../apps/desktop/src/renderer/vault.ts)) and keeps the seed in `WalletSeedContext`; `signer:set-seed` copies it to main | EVM send, message, typed-data and ERC-20 signing in main; BTC / SOL / Cosmos, WalletConnect and in-app dApp-browser requests in the renderer (the dApp view itself is sandboxed and never sees the seed) |
| **Mobile (React Native)** | Module-scope signer, [`lib/signer.ts`](../apps/mobile/lib/signer.ts) | `walletSeed` in App state ([`App.tsx`](../apps/mobile/App.tsx)), plus the signer module's copy | EVM through `lib/signer.ts`; WalletConnect and the in-app browser call `executeWcRequest` with the seed from App state |

## What the components still buy

- **Derived private keys** stay inside the signing component on web (EVM),
  the extension and desktop (EVM); UI code handles the seed, not per-account
  keys.
- **Crash reports and logs**: signing errors raised inside a worker,
  offscreen document or main process don't carry UI state; and every Sentry
  event is scrubbed of phrases and keys anyway (`SECURITY.md`, *Logging*).
- **Desktop**: a page loaded into the wallet window can't reach the signer
  — IPC is refused unless it comes from the app document's top frame
  (`src/main/ipc-guard.ts`), and navigation away from the app is blocked.

## What keeps injected script out of the UI

Because the UI holds the seed, the real line of defence is keeping foreign
script out of it:

- Web: a per-request nonce CSP on the wallet, no `'unsafe-inline'`
  (`apps/web/middleware.ts`, `lib/csp.js`).
- Desktop: a production meta CSP, `script-src 'self' 'wasm-unsafe-eval'`,
  and the window pinned to the app.
- Extension: the MV3 extension-pages CSP; privileged messages accepted only
  from extension pages.
- Mobile: dApps run in a WebView whose bridge only accepts requests stamped
  with a per-load nonce from the main frame.
- Every client: auto-lock clears the seed after idle time.

## Making it a boundary

Move the decrypt step into the isolated context, and give the UI only
addresses and signing RPCs:

- **Web**: decrypt inside the Worker (pass it the password or the session
  key, not the seed); route BTC / SOL / Cosmos signing through it; drop the
  page fallback.
- **Desktop**: decrypt in the main process and extend `signer.ts` to
  BTC / SOL / Cosmos, WalletConnect and the dApp browser; the renderer
  keeps a boolean "unlocked".
- **Extension**: decrypt in the offscreen document (or the service worker,
  keyed from `storage.session`); the popup sends requests, never the seed.
- **Mobile**: keep the seed only inside `lib/signer.ts`, and route
  WalletConnect and the in-app browser through it.

Then UI code can still *ask* for signatures (true of every wallet — which is
why every request goes through the decoded approval sheet), but a passive
read of UI state no longer yields the seed.

## What no in-app isolation protects against

- An attacker controlling the UI can ask the signer to sign; the approval
  sheets (decoded requests, one at a time, block verdicts) are the check.
- Memory dumps of the whole process or device.
- Phishing the user into pasting the seed somewhere else.

## Changing this

A change that moves key material further from the UI is welcome. A change
that moves it closer (e.g. dropping a signing component) needs a written
threat-model delta, a compensating control, and a review by someone outside
the change.
