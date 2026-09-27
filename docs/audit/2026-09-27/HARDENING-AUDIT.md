# Thanos Wallet — security hardening audit (2026-09-27)

Whole-codebase review of the wallet design and implementation, looking for
missing or ineffective hardening. Base commit `ed79232`. Branch
`claude/determined-faraday-u2xsch` carries the fixes listed below.

**Scope:** vaults and key handling on all four clients (web, extension,
desktop, mobile), signing isolation, dApp/WalletConnect request handling,
Electron and MV3 hardening, the mobile WebView and deep links, the backend
(`services/api`, indexer), deployment config and CI. Mostly a static review.
Every item marked **Fixed** was also reproduced against the original code
and then re-tested against the fix.

**Not covered in depth:** `contracts/` (compiled artifacts only),
`today-compliant/` (unrelated app), hardware-wallet transports, and the
per-chain clients in `packages/sdk-core/src/clients`. The mobile app was
reviewed statically only; it was not built or run.

## Summary

| | High | Medium | Low |
|---|---:|---:|---:|
| Fixed on this branch | 2 | 3 | — |
| Open | 6 | 10 | 11 |

The biggest structural gap is key isolation. Every client decrypts the vault
in its UI thread or renderer and keeps the mnemonic in UI state while it is
unlocked (H-1). Web and desktop also cache the raw vault AES key in
`sessionStorage` (H-2). So any script that runs in the wallet UI can read
the seed. This includes an XSS, a compromised dependency, or a remote page
loaded into the desktop window (the latter is fixed as F-1). The isolation
that `docs/SIGNING-ISOLATION.md` and `SECURITY.md` describe, and that the
external-audit RFQ points auditors to, does not match the code. See
[Documentation that contradicts the code](#documentation-that-contradicts-the-code).

---

## Fixed on this branch

| ID | Sev | Finding | Commit |
|---|---|---|---|
| F-1 | High | **Desktop:** a remote page loaded in the wallet window got the full `thanosDesktop` bridge (`signer.sendTx`, `vaultGet`), and no IPC handler checked its sender. | `56e8527` |
| F-2 | High | **Extension:** privileged runtime messages were accepted from content scripts. Affected: chain switch, approval results, WalletConnect approve/respond, and forged `wc.event.request` shown on the approval sheet (approving broadcasts the tx). | `097081c` |
| F-3 | Medium | **Extension:** `accountsChanged` with the wallet address was broadcast to **every** open tab, so any site learned the address. | `097081c` |
| F-4 | Medium | **API:** refresh-token rotation was not atomic (concurrent refreshes both succeeded); login answered unknown emails measurably faster (account enumeration by timing); push secret compared with `!==`. | `ac37555` |
| F-5 | Medium | **Ops:** unauthenticated Prometheus `/metrics` was public at `/api/metrics` and `/indexer/metrics` through nginx, contrary to the comment in `app.ts`. | `caf86ea` |

### F-1 — desktop wallet window could be navigated to a remote page

- **Cause:** the `BrowserWindow` (`apps/desktop/src/main/index.ts`) had no
  `will-navigate` or `setWindowOpenHandler` guard. Electron keeps a
  webContents' preload across navigations, and the handlers for `signer:*`,
  `vault:*`, `shell:*`, `clipboard:*`, `ledger-native:*`, `updater:*` and
  `dapp:*` never looked at `event.senderFrame`.
- **Reproduced** with the real compiled main process under Electron 33.4.11
  and Xvfb:
  - After a renderer-initiated navigation, the attacker page received the
    bridge. `vaultGet` resolved, and `sendTx` reached the signer; it was
    refused only because the test wallet was locked.
  - `target="_blank"` links opened remote pages in bare in-app windows.
    Electron does not block this by default, whatever the comment at
    `main.tsx:5632` says. Those child windows did **not** get the preload.
- **Fix** (`apps/desktop/src/main/ipc-guard.ts`):
  - `lockToApp()` blocks navigation and redirects to non-app URLs, denies
    `window.open`, sends http(s) links to the user's browser, and blocks
    `<webview>`.
  - `handleTrusted()` rejects IPC unless it comes from the top frame of the
    app document. All wallet-window channels use it. `dapp:rpc` keeps its
    own check that the sender is the dApp view.
- **Verified:**
  - The attacker URL is never loaded in-app.
  - With the lock bypassed (programmatic `loadURL`), the guard still rejects
    the attacker page's IPC.
  - The app document's own calls still resolve.
  - `isAppUrl` was checked in both dev (`localhost:5173`) and packaged
    (`file://…/index.html`) modes.

### F-2 / F-3 — extension messaging

- **Why it matters:** `runtime.sendMessage` from a content script reaches the
  background, popup and offscreen listeners, and a content script runs in the
  web page's renderer process. None of the listeners checked `sender`:
  - `background.ts` also keyed `thanos-rpc` permissions on the `origin` field
    in the message body.
  - The offscreen signer and WalletConnect host acted on anything tagged
    `__target:'offscreen'`.
- **Fix:** `apps/extension/src/lib/message-sender.ts` adds
  `isExtensionSender()` and `contentScriptOrigin()`.
  - `thanos-rpc` now takes its origin from the browser-reported sender.
  - Every other message requires an extension-page sender.
  - `accountsChanged` goes only to connected origins.
- **Verified in Chromium** with the unpacked build (Playwright, plus CDP into
  the content script's isolated world). On the original build:
  - a forged `thanos-set-chain` switched the chain;
  - the content script reached the offscreen host directly;
  - an unconnected site received the address.

  On the fixed build all three are refused. Content-script RPC, popup
  privileged messages, service worker → offscreen, and connected-site
  `accountsChanged` / `eth_accounts` still work.

### F-4 — API auth

- **Refresh:** `/auth/refresh` now rotates with a compare-and-swap on the
  presented token's hash (`… AND refresh_token = $4 AND revoked = false
  RETURNING id`). The loser of a race gets 401.
- **Login:** unknown or inactive emails now pay one Argon2id verify against a
  dummy hash.
- **Push:** `/push/notify` uses `timingSafeEqual`.
- **Tests:** three new auth tests (all fail on the old code) and a new
  `push.test.ts`. The suite is 75 passed / 11 skipped; the skipped ones need
  Postgres.

### F-5 — public metrics

- **Fix:** a case-insensitive regex `location` in
  `scripts/nginx-thanos-wallet.conf` and `scripts/nginx-staging.conf`
  returns 404 for `/api/metrics` and `/indexer/metrics`. That includes the
  `/METRICS`, trailing-slash, `//` and `%6d` spellings that Express would
  still route.
- **Verified** with nginx 1.24 against the extracted blocks. Other routes
  still proxy.
- **Deploy:** copy the config to the VPS, then `nginx -t && systemctl reload
  nginx`.

---

## Open findings

### High

**H-1 — The seed lives in UI-thread / renderer JavaScript on all four clients.**
Each client's "isolation" boundary is bypassed by its own UI code:

| Client | Where the seed sits | Location |
|---|---|---|
| Web | `useWalletGate` keeps `walletSeed` and `walletPrivateKey` in React state; the signing worker only duplicates them | `apps/web/components/onboarding.tsx:610-640` |
| Desktop | Renderer decrypts the vault and keeps the seed in `WalletSeedContext`; BTC/SOL/Cosmos, WalletConnect and dApp-browser signing all run in the renderer. The main-process signer is a copy, not a boundary. | `apps/desktop/src/renderer/main.tsx:5910, 6093`; `send.ts:107-193`; `wc-signer.ts:39-120` |
| Extension | Popup holds `seed` in state and posts it to the offscreen document with every signing call | `popup/main.tsx:5157, 5656`; `popup/offscreen-sign.ts:8-10` |
| Mobile | `walletSeed` in App state, passed to `executeWcRequest` | `apps/mobile/App.tsx:8906` |

**Fix:** move the decrypt step into the isolated context, and give the UI
only addresses and signing RPCs:
- web: decrypt inside the Worker;
- desktop: decrypt in the main process, extending the existing `signer.ts`
  to BTC/SOL/Cosmos;
- extension: decrypt in the offscreen document, or in the service worker via
  `storage.session`;
- mobile: keep the seed only inside `lib/signer.ts`.

Until then, correct the documentation.

**H-2 — Raw vault AES key cached in `sessionStorage` (web, desktop), and the
web CSP allows inline script.**
- **Where:** `apps/web/lib/vault.ts:360-373`,
  `apps/desktop/src/renderer/vault.ts:349-362`. The key sits next to the
  `localStorage` vault it decrypts, so any main-thread script decrypts the
  seed with two synchronous reads.
- **CSP:** `apps/web/next.config.js:17` allows `script-src 'unsafe-inline'`,
  so an HTML-injection bug becomes script execution. SECURITY.md lists the
  CSP as the XSS mitigation.
- **Fix:**
  - Hold a non-extractable `CryptoKey` inside the signing worker instead. If
    it must survive a reload, store it in IndexedDB; the structured clone of
    a non-extractable key cannot be exported.
  - Move Next.js to nonce-based CSP via middleware.

**H-3 — Auto-lock is advertised but not implemented on web and desktop;
mobile defaults to "Never".**
- **Web / desktop:** the "Auto-lock" selects are plain `useState`, never
  persisted and never read (`apps/web/components/views.tsx:1454`,
  `apps/desktop/src/renderer/main.tsx:4480`). An unlocked wallet stays
  unlocked for the life of the tab or process, and on web it also survives
  reloads via H-2.
- **Mobile:** defaults to 0 = never (`apps/mobile/App.tsx:7271-7277`) and
  only checks when the app returns from background
  (`App.tsx:9147-9162`).
- **Fix:** an idle timer (input events plus `visibilitychange`) that calls
  the existing `lock()` and clears the cached key. Default 5–15 min; do not
  offer "Never" without a warning.

**H-4 — Blind EIP-712 signing everywhere; the WalletConnect risk scorer is
dead code.**
- **Where:** every client summarises `eth_signTypedData_v4` as "Sign typed
  data (EIP-712)." (for example `apps/extension/src/entrypoints/popup/wc-signer.ts:63`,
  `apps/mobile/lib/wc-signer.ts:108`).
- **Missing checks:** no client decodes Permit / Permit2 / Seaport or shows
  spender, amount and deadline, and none checks `domain.chainId` against the
  active chain.
- **Dead code:** `packages/sdk-core/src/security/wc-risk.ts` (`scoreWcRequest`,
  with its "block" verdict) is not imported by any app.
- **No simulation:** dApp-originated transactions on the extension and
  desktop show only `to` (and value).
- **Fix:** wire `scoreWcRequest` into every approval sheet, decode
  permit-style typed data, reject a `domain.chainId` mismatch, and show
  decoded calldata for approve / `setApprovalForAll`.

**H-5 — A wallet private key is committed to the repository and allowlisted
in gitleaks.**
- **Where:** `apps/mobile/store-listing/PLAY-APP-ACCESS.md:75` contains the
  "demo" private key. `.gitleaks.toml:11` exempts it, and the same document
  recommends funding the address.
- **Why it matters:** the source is described as public in
  `docs/SECURITY-AUDIT-SCOPE.md`, so any funds sent there can be swept.
- **Fix:** treat the key as burned. Generate a new reviewer key and deliver it
  only through Play Console. Remove it from the document. Keep the allowlist
  entry only as long as the value remains in git history.

**H-6 — Release and CI builds do not use the lockfile.**
- **Where:** `pnpm install --no-frozen-lockfile` in
  `.github/workflows/release.yml:37, 69, 137, 219`, `ci.yml`, `sbom.yml` and
  `extension-release.yml:22`. Shipped desktop and extension artifacts are
  built from whatever the registry resolves that day, so the SBOM does not
  describe what ships.
- **Unblocked:** `pnpm install --frozen-lockfile` followed by `wxt build`
  succeeds on this commit. The "extension build broken" gap from the
  2026-08-27 package does not reproduce with the frozen lockfile.
- **Fix:** switch all workflows to `--frozen-lockfile`, pin actions to commit
  SHAs, and make the dependency audit blocking again. The accepted-risk
  GHSAs are already allowlisted.

### Medium

**M-1 — Mobile vault: a weak KDF floor and a backup-portable keychain class.**
- **Where:** new vaults calibrate PBKDF2-SHA256 to about 0.6 s with a floor
  of **10,000** iterations (`apps/mobile/lib/vault.ts:61-63`). They are stored
  `AFTER_FIRST_UNLOCK` rather than `*_THIS_DEVICE_ONLY` (`vault.ts:138-146`),
  so the blob can leave the device in encrypted backups.
- **Why it matters:** once the blob is off the device, a 10k-iteration
  PBKDF2 over an 8-character password is cheap to crack offline.
- **Fix:** use a native KDF (`react-native-quick-crypto` or native Argon2)
  with a floor of at least 210k PBKDF2 or Argon2id, and use
  `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`. Restore from the recovery phrase.

**M-2 — Extension "Never (stay unlocked)" writes the raw vault key to disk.**
- **Where:** `apps/extension/src/entrypoints/popup/session-store.ts:76-78`
  puts the AES key in `storage.local`, beside the vault. That removes
  encryption at rest.
- **Fix:** remove the option, or cap it at "until browser closes"
  (`storage.session`). If it stays, label it plainly as disabling encryption.

**M-3 — Mobile biometric unlock is a UI gate, not bound to the key.**
- **Where:** `apps/mobile/lib/biometric.ts:115-141` stores the vault key
  without `requireAuthentication`. The only gate is an
  `authenticateAsync` prompt.
- **Consequences:**
  - Passcode fallback is allowed, so anyone who knows the device passcode
    unlocks the wallet.
  - Enrolling a new fingerprint does not invalidate the key.
  - Instrumentation on a rooted or jailbroken device reads the key directly.
- **Fix:** `requireAuthentication: true` on the slot (biometry-current-set
  access control), accepting the single OS prompt that comes with it.

**M-4 — Mobile in-app browser: request attribution and the approval race.**
- **Where:** `apps/mobile/App.tsx:8199-8250`.
- **Attribution:** requests are attributed to the top-level `host` state,
  not the frame that posted them. On Android the
  `ReactNativeWebView.postMessage` bridge is reachable from cross-origin
  iframes, so an ad iframe on a connected dApp can raise approval sheets
  labelled with the dApp's host.
- **Race:** a new request replaces the one being shown (`setPending(req)`,
  `App.tsx:8237`), so a page can swap the request just before the user taps
  Approve.
- **Fix:**
  - Embed a per-load nonce in `INJECTED_PROVIDER_JS` (main frame only) and
    reject messages without it.
  - Check `nativeEvent.url` against `connectedHost`.
  - Queue requests, or reject new ones while a sheet is open.

**M-5 — The recipient phishing check exists only on web.**
- **Where:** `classifyRecipient` is used only by `apps/web/components/modals.tsx`.
  The extension, desktop and mobile Send flows have no recipient check, and
  `packages/sdk-core/src/security/phishing.ts` exports only `inspectWebsite`.
  This contradicts SECURITY.md.
- **Fix:** move the classifier to sdk-core and call it from every Send flow.

**M-6 — Anyone can subscribe to any address's activity pushes.**
- **Where:** `POST /push/register` is unauthenticated and binds any Expo token
  to any address (`services/api/src/routes/push.ts:26-33`). This is the
  address ↔ push-token correlation risk named in the audit scope.
- **Fix:** require an EIP-191 signature over a server nonce from the address
  being registered.

**M-7 — LAX card webhook and sensitive card endpoints.**
- **Webhook** (`services/api/src/routes/lax.ts:669-676`): a static shared
  secret with no HMAC over the body, no timestamp and no replay window.
- **Card data:** raw payloads, including `card_number` (the schema accepts a
  PAN or a provider ID), are stored in `lax_webhook_events`.
- **Card endpoints:** `GET /lax/card/:cardNumber/details` and `/pin` need only
  a bearer JWT (`lax.ts:562-627`), and card numbers travel in URL paths,
  which end up in access logs.
- **Fix:**
  - Ask Zypto for a signed-webhook scheme.
  - Store only the fields you need.
  - Require step-up re-authentication for PIN and details.
  - Move card identifiers out of paths.

**M-8 — The desktop renderer has no Content-Security-Policy.**
- **Where:** `apps/desktop/index.html` has no CSP meta. With F-1 in place the
  window only shows the app, but an injection inside the app still has no
  script policy.
- **Fix:** add a CSP matching the web one, without `'unsafe-inline'` for
  scripts.

**M-9 — The only password policy is a minimum length of 8.**
- **Where:** every client (for example `apps/web/components/onboarding.tsx:140`).
  There is no strength estimation, which compounds M-1 and makes any
  exfiltrated vault from H-2 easier to crack offline.
- **Fix:** add zxcvbn-style scoring with a minimum score.

**M-10 — The recovery phrase and private key are copied to the clipboard and
never cleared.**
- **Where:** `apps/mobile/App.tsx:6664, 7944` and
  `apps/desktop/src/renderer/main.tsx:5441`.
- **Fix:** clear after about 60 s if the clipboard is unchanged. On Android
  13+, mark the clip sensitive.

### Low

| ID | Finding | Location |
|---|---|---|
| L-1 | Access tokens stay valid for up to 15 min after logout or session revoke; `requireAuth` never checks `sessions.revoked`. | `services/api/src/middleware/auth.ts` |
| L-2 | `/auth/register` answers 409 for a registered email (account enumeration). | `routes/auth.ts` |
| L-3 | Unused raw sign-tx paths with no `chainId` pinning are still exposed: desktop `signer:sign-tx` (`signer.ts:83-105`, which drops `chainId`) and extension `sign.evm-sign-tx`. Neither has a caller. A legacy tx without `chainId` would be signed without replay protection. Remove them, or pin `chainId`. | desktop `main/signer.ts`, extension `offscreen/main.ts:196` |
| L-4 | The desktop dApp-browser approval dialog shows only `to`/value for transactions and resolves the origin from the global `currentUrl` rather than `e.senderFrame`. | `main/dapp-browser.ts:139-160, 342` |
| L-5 | GitHub Actions are pinned to tags, not SHAs; the dependency-audit job is `continue-on-error`. | `.github/workflows/*` |
| L-6 | Compose falls back to `thanos_dev_secret` / `redis_dev_secret` if the VPS `.env` lacks them. Use `${POSTGRES_PASSWORD:?}` in the prod overlay. | `docker-compose.yml:21, 41` |
| L-7 | Sentry scrubbing matches key names only; a seed inside an error message or breadcrumb string is not scrubbed. | `apps/web/sentry.client.config.ts:24-33` |
| L-8 | Android `allowBackup` is not disabled (AsyncStorage holds grants and the address book). The `thanoswallet://` and `wc:` schemes can be claimed by other apps. | `apps/mobile/app.json` |
| L-9 | Desktop keychain hydration omits account names and the hidden-accounts list: hidden accounts reappear after restart in the packaged app, and `clearVault` leaves both in the keychain. | `apps/desktop/src/renderer/vault.ts:414-420` |
| L-10 | The extension requests host permissions for all http(s) sites, and extension pages allow `frame-src` for the LAX widgets. | `apps/extension/wxt.config.ts:77, 92` |
| L-11 | `typescript.ignoreBuildErrors` / `eslint.ignoreDuringBuilds` in the web build; CI typecheck is the only gate. | `apps/web/next.config.js:94-96` |

---

## Documentation that contradicts the code

The external-audit RFQ (`docs/SECURITY-AUDIT-SCOPE.md`) sends auditors to
these documents, so fix them before an engagement starts.

- **`SECURITY.md`**
  - It says every vault uses Argon2id (t=3, m=64MB, p=4). New web and
    extension vaults actually use PBKDF2-SHA256 (600k). New mobile vaults use
    PBKDF2 calibrated between 10k and 600k. Only desktop uses Argon2id.
  - It cites `apps/desktop/src/main/keyvault.ts`, `apps/desktop/src/main/main.ts`
    and `services/api/src/lib/argon2.ts`, none of which exist.
  - It says the extension background restricts WebHID. The extension has no
    HID code.
  - It says sdk-core classifies every Send recipient (see M-5).
  - It presents a "strict CSP" as the XSS mitigation (see H-2).
- **`docs/SIGNING-ISOLATION.md`:** all four rows are contradicted by H-1.
- **`docs/production-readiness-audit.md`:** its signing-isolation table
  repeats the same claims, including that the mobile seed is "never in
  component state".
- **Code comments**
  - The header comments in `apps/web/lib/vault.ts` and
    `apps/extension/src/lib/vault.ts` still say Argon2id.
  - `apps/desktop/src/renderer/main.tsx:5632` says Electron blocks
    `window.open` by default. It does not; this was verified under F-1.
- **`docs/audit/2026-08-27/README.md`, known gap #1:** the extension build
  works with `--frozen-lockfile` on this commit.

## Verified sound

These were checked and hold up, so a later review does not need to redo them:
- **Vault crypto:** AES-256-GCM with a fresh 96-bit IV and 128-bit salt per
  vault, and the KDF parameters are stored with each vault. The legacy
  plaintext migration wipes the old keys.
- **`eth_sign`:** every client maps it to EIP-191 `personal_sign`, so there is
  no raw-hash signing.
- **Extension dApp handling:**
  - Connect-before-sign is enforced, and `from` / signer must match the
    connected account.
  - Only chains on the allowlist can be selected, and a dApp cannot add an
    arbitrary RPC.
- **Desktop dApp browser:**
  - It uses a separate session partition, runs sandboxed and denies all
    permissions.
  - It enforces a top-frame check and origin-scoped grants, and approval
    dialogs default to Cancel.
- **Mobile:**
  - The deep-link "open" handler checks an allowlist.
  - `FLAG_SECURE` is set on Android seed screens.
  - The biometric slot uses `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
- **API authentication**
  - JWT algorithm is pinned to HS256, and a secret of 32+ characters is
    enforced.
  - Refresh tokens are hashed in the database, and passwords use Argon2id.
  - Auth endpoints are rate-limited, and `trust proxy` is set to 1.
- **API request handling**
  - SQL is parameterized throughout, and inputs are validated with zod.
  - LAX card routes check ownership, and the webhook secret is compared with
    `timingSafeEqual`.
  - CORS uses an allowlist, and upstream path segments are
    `encodeURIComponent`-escaped.
- **Web headers:** HSTS with preload, `frame-ancestors 'none'`,
  `X-Frame-Options DENY`, `nosniff`, a Permissions-Policy, and Sentry replay
  turned off.

## Suggested order

1. H-5: rotate the committed key (minutes).
2. H-6: frozen lockfile and SHA-pinned actions (no longer blocked).
3. H-3: a real auto-lock on all clients.
4. H-2: drop the `sessionStorage` key cache and move to a nonce CSP.
5. H-4: typed-data decoding plus `scoreWcRequest` on every approval sheet.
6. H-1: move decryption behind each client's isolation boundary.
7. The Medium items, then correct the documentation.
