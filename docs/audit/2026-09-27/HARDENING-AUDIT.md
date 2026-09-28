# Thanos Wallet — security hardening audit (2026-09-27)

Whole-codebase review of the wallet design and implementation, looking for
missing or ineffective hardening. Base commit `ed79232`. Branch
`claude/determined-faraday-u2xsch` carries the fixes listed below.
**Status updated 2026-09-28**, after remediation on the same branch — see
[Remediation status](#remediation-status-2026-09-28). The findings further
down are kept as reported.

**Scope:** vaults and key handling on all four clients (web, extension,
desktop, mobile), signing isolation, dApp/WalletConnect request handling,
Electron and MV3 hardening, the mobile WebView and deep links, the backend
(`services/api`, indexer), deployment config and CI. Mostly a static review.
Every item marked **Fixed** was also reproduced against the original code
and then re-tested against the fix.

**Not covered in depth:** `contracts/` (compiled artifacts only),
`today-compliant/` (unrelated app), hardware-wallet transports, and the
per-chain clients in `packages/sdk-core/src/clients`. The mobile app was
reviewed statically; remediation testing later ran it as a
react-native-web build, but no native build was run.

## Summary

| As of 2026-09-28 | Critical | High | Medium | Low |
|---|---:|---:|---:|---:|
| Audit findings fixed | — | 6 | 9 | 7 |
| Partly fixed | — | 1 | — | 1 |
| Still open | — | 1 | 4 | 3 |
| Found and fixed during remediation | 1 | 2 | 2 | 3 |

(The audit reported 8 High, 13 Medium and 11 Low, counting F-1 – F-5.)

The biggest structural gap is still key isolation (H-1, open): every client
decrypts the vault in its UI thread or renderer and keeps the mnemonic in UI
state while it is unlocked, so script that runs in the wallet UI can read
the seed. What changed is how much stands between injected script and that
UI — a per-request nonce CSP on the web wallet, a CSP on the desktop
renderer, sender checks in the extension and the desktop window — and what
a dApp can get signed: every request is now decoded, checked against the
wallet's chain and account, shown one at a time, and never signed without
the user's approval. The worst issue of the whole exercise was found during
remediation: the web WalletConnect host signed, and broadcast, without
asking (N-1). The security documents now describe the code as it is.

---

## Remediation status (2026-09-28)

### Audit findings

| ID | Sev | Status | Commits | Notes |
|---|---|---|---|---|
| F-1 – F-5 | High / Med | Fixed | see [below](#fixed-with-the-audit-f-1--f-5) | |
| H-1 | High | **Open** | — | Architectural: decrypt behind each client's isolation boundary (`docs/SIGNING-ISOLATION.md`). The web worker now actually receives the wallet (N-2), but the seed is still also in UI state on every client. |
| H-2 | High | **Partly fixed** | `134b99d`, `418e5d5` | The web wallet (`/app`) gets a per-request nonce CSP with no `'unsafe-inline'`: injected event handlers and parser-inserted scripts are refused (`e2e/csp.spec.ts`), and the e2e suite gives the same results with CSP enforced as with it bypassed. Public pages keep a static policy (pre-rendered, shared-cached, no keys); links into the wallet are full page loads. The raw key in `sessionStorage` stays — a decision, see [What's left](#whats-left). |
| H-3 | High | Fixed | `cfba326`, `e4998b4` | Idle auto-lock on web, desktop and mobile (default 15 min; timestamps + `visibilitychange`; a reload after the timeout asks for the password). The extension also locks a popup left open. |
| H-4 | High | Fixed | `9b4ec89`, `4916998`, `7d3f24d`, `32ddff4`, `58df3f9`, `2eb5937` | sdk-core `reviewSigningRequest` on every approval sheet: EIP-2612 / DAI permits, Permit2, Seaport, approve / `setApprovalForAll` / transfers decoded; chain and account checked; a block verdict offers Reject only. `scoreWcRequest` now scores the decoded review. |
| H-5 | High | Fixed in the repo — **rotate the key** | `0af31be` | Removed from the guide; the gitleaks allowlist keeps the literal only because it is in git history. |
| H-6 | High | Fixed | `32eef66` | `--frozen-lockfile` in every workflow; the dependency audit is blocking. SHA pinning is L-5. |
| M-1 | Med | Open — decision | — | Needs a native KDF and a vault migration; `*_THIS_DEVICE_ONLY` drops the vault from encrypted-backup restores (users restore from the phrase). |
| M-2 | Med | Fixed | `d7a85e4` | "Never" removed; a leftover disk copy is deleted on sight. |
| M-3 | Med | Open — decision | — | `requireAuthentication` on the biometric slot changes the unlock UX (an OS prompt; re-enrol after biometric changes). |
| M-4 | Med | Fixed | `58df3f9` | Per-browser nonce injected in the main frame only; requests attributed to the URL that sent them; one sheet at a time (`-32002`). |
| M-5 | Med | Fixed | `88dc456` | sdk-core `checkRecipient` on every Send screen — warns while typing, refuses at submit, after name resolution. |
| M-6 | Med | Open | — | Needs a signed-nonce registration: an API change plus a mobile release. |
| M-7 | Med | Open — partner | — | Signed webhooks need Zypto. Storing only the needed fields, step-up auth for PIN / details, and moving card identifiers out of paths are API work not yet done. |
| M-8 | Med | Fixed | `6e25292` | Production renderer meta CSP: `script-src 'self' 'wasm-unsafe-eval'`. |
| M-9 | Med | Fixed | `f49dc25` | A floor, not a meter: common, l33t, padded or doubled passwords, runs, repeats and short numbers-only are refused wherever a password is set, on all four clients. |
| M-10 | Med | Fixed | `88dc456` | Wiped after 60 s (desktop: only if unchanged, and on quit). Android 13's sensitive-clip flag isn't exposed by `expo-clipboard`, so it isn't set. |
| L-1 | Low | Fixed | `57aef76` | `requireAuth` checks the token's session (owner, revoked, expiry) on every request; a failed lookup is a 500, not a 401. |
| L-2 | Low | Open | — | A uniform answer needs email verification first. |
| L-3 | Low | Fixed | `89dc679` | Both raw sign-tx paths removed. |
| L-4 | Low | Fixed | `32ddff4` | Decoded review in the dialog; origin from `e.senderFrame`. |
| L-5 | Low | Partly fixed | `32eef66` | The audit job blocks. Actions are still pinned to tags; pinning needs the upstream SHAs. |
| L-6 | Low | Fixed | `f93b75c` | The prod overlay requires both passwords (`${VAR:?}`) — read the deploy note under [What's left](#whats-left). |
| L-7 | Low | Fixed | `5dcda8e` | sdk-core telemetry scrub on web (client, server, edge) and mobile: strings are scanned for phrases, 32-byte hex and xprv / WIF / Solana keys; an event that can't be scrubbed is dropped. |
| L-8 | Low | Fixed (backup) | `df36572` | `android:allowBackup="false"`. Custom schemes can always be claimed; the verified https App Links on thanos.fi are the safe path. |
| L-9 | Low | Fixed | `4e3fc6f` | Both keys hydrated at boot and wiped with the vault. |
| L-10 | Low | Open — by design | — | The injected provider needs every site; the LAX widgets need `frame-src`. |
| L-11 | Low | Open | — | CI's typecheck remains the only gate for the web build. |

### Found during remediation (all fixed)

| ID | Sev | Commit | Finding |
|---|---|---|---|
| N-1 | **Critical** | `4916998` | **Web WalletConnect signed without asking.** `personal_sign` was auto-approved, and typed data and transactions that the local classifier called "safe" were signed — transactions broadcast — silently. Any connected dApp could send itself the whole native balance, or take tokens and NFTs through Permit2 or Seaport, with no prompt. Every request now waits in the confirm sheet. |
| N-2 | High | `f0a6bc2` | The web signing worker never received the unlocked wallet: its `init` message arrived before the listener existed (behind an async WebAssembly import) and was dropped. Send and WalletConnect silently fell back to the main thread, so the worker isolation was never in use, and Quantt sign-in failed. A ready handshake fixes the race. |
| N-3 | High | `6315529` | Desktop cold start showed "Create a new wallet" to users who had a vault, and create / import then overwrote it without asking. |
| N-4 | Medium | `4916998`, `7d3f24d`, `32ddff4` | The M-4 approval race also existed on web WalletConnect, the extension and desktop WalletConnect: a new request replaced the sheet on screen (the replaced one was never answered), so a page could swap what the user was about to approve. |
| N-5 | Medium | `ace8da7` | Quantt sign-in and withdrawal-binding challenges were signed without validation. A tampered API response (compromised API, DNS, CDN) could put a Permit / Permit2 payload in their place. |
| N-6 | Low | `7d3f24d` | Extension: every rejection reached dApps as `-32603` (runtime messaging drops `.code`), so "user rejected" and "request pending" looked like internal errors. |
| N-7 | Low | `5ebd71c` | Mobile: the default style sheet read `const`s before their declaration — react-native-web crashed at startup; Hermes built it from undefined values. |
| N-8 | Low | `418e5d5` | Web `connect-src` lacked four configured RPCs — Lithosphere mainnet's only RPC, the Solana and BSC primaries, Solana devnet — so the browser blocked them in production. A unit test now checks every configured RPC. |

### Testing

- Unit: sdk-core 279 (twins tested together), API 80 plus 13 against real
  Postgres, web 27.
- Web e2e against a production build (`next build && next start`), with page
  CSP enforced: 27 pass. The same 10 tests fail with CSP bypassed too —
  stale selectors in the DNNS, import-wallet, permissions, send-receive and
  settings specs. The suite is not run in CI.
- Extension, desktop renderer, Electron and a react-native-web build of the
  mobile app were driven with Playwright for each client-side change.
- No Quantt sandbox exists: the Quantt work ran against a mocked API only.

---

## Fixed with the audit (F-1 – F-5)

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

## Findings as reported (2026-09-27)

These were open when the audit was written. Their current status is in
[Remediation status](#remediation-status-2026-09-28); the text below is
unchanged, so file and line references point at the base commit.

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

**Status (2026-09-28): corrected** — commit "docs: make the security docs
describe the code as it is" rewrites `SECURITY.md` and
`docs/SIGNING-ISOLATION.md` to match the code (H-1 stated as open), fixes
the signing table in `docs/production-readiness-audit.md`, the vault
headers and the desktop `window.open` comment, notes the lockfile fix in the
2026-08-27 package, and points the RFQ at this report.

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

## What's left

The suggested order from 2026-09-27 (H-5, H-6, H-3, H-2, H-4, H-1, the
Medium items, the documentation) has been worked through except where noted
below.

### Actions for the owner

1. **Rotate the burned reviewer key** (H-5): generate a new one, give it to
   Google only through Play Console's App access fields, and never fund the
   old address.
2. **Before the next production deploy** (L-6): make sure the VPS `.env`
   sets `POSTGRES_PASSWORD` and `REDIS_PASSWORD` — the prod overlay now
   refuses to start without them. A database first initialised on the old
   fallback still has `thanos_dev_secret`: set that value first so the
   services can log in, then rotate with the `ALTER USER` command in
   `docker-compose.prod.yml`.
3. **Deploy the nginx configs** (F-5): copy them to the VPS, then
   `nginx -t && systemctl reload nginx`.
4. **Pin GitHub Actions to commit SHAs** (L-5).
5. **Ask Zypto for signed webhooks** (M-7).
6. **Smoke-test the Quantt changes against production** with a test
   account: sign-in, a settings change, the live decision stream, and the
   kill-switch response shape (the route isn't in the committed 0.4.0
   spec).

### Decisions

- **H-1 — key isolation**, the largest remaining item; the path per client
  is in `docs/SIGNING-ISOLATION.md`.
- **H-2 (remainder) — the web session key.** Keeping the raw key in
  `sessionStorage` lets a reload skip the password, but browsers write
  session storage to disk for session restore. A non-extractable key in
  IndexedDB is on disk too and still usable by any script on the origin;
  the only real fix is asking for the password on every reload.
- **M-1 / M-3 — mobile KDF, keychain class and biometric binding**: UX and
  migration trade-offs.
- **M-6 — signed push registration** (API + mobile release).
- **L-2, L-10, L-11** as noted in the status table.

### Observations (not scored)

- Next 15 loads Sentry's server and edge configs only from an
  `instrumentation.ts`, and `apps/web` has none, so server-side Sentry
  never initialises there. The browser config is unaffected.
- The extension advertises `eth_signTransaction` to WalletConnect dApps,
  but no handler implements it.
- Web WalletConnect broadcasts on Makalu only (the chain its signer
  uses); a transaction for a session on another chain is blocked.
- The web e2e suite is not run in CI, and 10 of its tests are stale (see
  *Testing* above).
