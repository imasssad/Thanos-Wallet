# Security model

This document records the deliberate security choices in Thanos Wallet so future
contributors don't undo them. For incident-response procedures see
`ops/backups/RUNBOOK.md`; for observability + alert routing see `OBSERVABILITY.md`.
The latest review and its open items: `docs/audit/2026-09-27/HARDENING-AUDIT.md`.

---

## Vault — what protects the user's seed

- **Encryption-at-rest**: AES-256-GCM with a fresh random 96-bit IV and a
  random 128-bit salt per vault. The KDF and its parameters are stored with
  each vault, so every vault opens with exactly what it was made with.
- **Key derivation and storage, per client:**

  | Client | KDF for new vaults | Vault stored in | Key while unlocked |
  |---|---|---|---|
  | Web (`apps/web/lib/vault.ts`) | PBKDF2-SHA256, 600,000 iterations (older Argon2id vaults still open) | `localStorage` | `sessionStorage`, so a reload doesn't re-prompt (see *Known limits*) |
  | Extension (`apps/extension/src/lib/vault.ts`) | PBKDF2-SHA256, 600,000 iterations | extension-origin `localStorage` | `chrome.storage.session` (RAM-backed, gone when the browser closes) for the chosen session length |
  | Desktop (`apps/desktop/src/renderer/vault.ts`) | Argon2id, t=3, m=64 MiB, p=4 | renderer `localStorage`, mirrored to the OS keychain | `sessionStorage` (memory; Electron doesn't restore sessions) |
  | Mobile (`apps/mobile/lib/vault.ts`) | PBKDF2-SHA256 calibrated per device to ~0.6 s, 10,000–600,000 iterations | `expo-secure-store` (Keychain / Keystore) | module memory |

- **New passwords** must be 8+ characters and not a common or patterned
  password (sdk-core `passwordProblem`, mobile twin `lib/password-strength.ts`):
  common passwords with l33t swaps or digits tacked on, keyboard / alphabet
  runs, too few distinct characters, short numbers-only. Checked only where a
  password is *set* (create, import, change) — never where an existing one is
  typed, so older weak passwords keep unlocking.
- **Auto-lock**: sdk-core `startIdleLock` locks web, desktop and mobile after
  15 min without input by default (1 / 5 / 15 / 60 min, or "Never" — labelled
  not recommended). Idle time is measured from timestamps, so a throttled tab
  or a machine that slept still locks on time, and a reload after the timeout
  asks for the password. The extension locks after its session length (15 min
  / 1 h / 4 h / until the browser closes), including a popup left open.
- **Mnemonic never leaves the device.** No client ever serializes the seed or
  the derived private key into an API call.

### Known limits

- **The seed is in UI memory while unlocked.** Every client decrypts the
  vault in its UI thread / renderer and keeps the mnemonic there; the
  signing workers and processes are copies, not boundaries
  (`docs/SIGNING-ISOLATION.md`, audit H-1). Script running in the wallet UI
  can read it — which is why the CSPs below matter.
- **Web session key.** The raw AES key in `sessionStorage` lets a reload skip
  the password, but Chrome writes session storage to disk for session
  restore, next to the vault. The alternatives: a non-extractable key in
  IndexedDB (also on disk, and still usable by any script on the origin), or
  asking for the password on every reload (audit H-2 — a product decision).
- **Mobile:** the PBKDF2 floor is low for a JS KDF and the vault's keychain
  class travels in encrypted backups (M-1); biometric unlock is a UI gate,
  not bound to the key (M-3).

## Signing — what the user sees before anything is signed

- **Decoded requests.** sdk-core `reviewSigningRequest` (twins:
  `apps/mobile/lib/sign-review.ts`, `apps/desktop/src/main/sign-review.ts`)
  decodes what a dApp asks to sign on every client's approval sheets —
  EIP-2612 / DAI permits, Permit2, Seaport orders, approve /
  `setApprovalForAll` / transfers — and checks the signature's or
  transaction's chain and account against the wallet's. A **block** verdict
  (wrong chain, wrong account, known scam address, a Seaport order that pays
  the signer nothing, malformed typed data) offers Reject only.
- **One request at a time.** A new request never replaces the one on screen:
  WalletConnect requests queue; an in-page request made while one is waiting
  gets `-32002`.
- **Web WalletConnect signs only after an explicit approval** — every
  `personal_sign`, typed-data and transaction request goes through the
  confirm sheet (`apps/web/lib/wc-requests.ts`).
- **`eth_sign`** is mapped to EIP-191 `personal_sign` everywhere; no
  raw-hash signing.
- **Quantt challenges** are validated before signing (sdk-core
  `quantt/challenge.ts`): the Quantts.ai domain, no approval / order types,
  every address the wallet's own.

## Logging — what we never write

- **Sentry, web and mobile** (`apps/web/sentry.{client,server,edge}.config.ts`,
  `apps/mobile/lib/sentry.ts`): every event and transaction goes through
  sdk-core `scrubOrDropEvent` (`security/telemetry-scrub.ts`). Fields whose
  name matches

  ```
  /(mnemonic|phrase|seed|password|passphrase|private[_-]?key|secret|vault|session[_-]?key|token|authorization|cookie)/i
  ```

  are replaced whole, and every string is scanned: runs of 8+ BIP-39 words,
  lone 32-byte hex strings (private keys, WalletConnect symKeys — tx hashes
  go too), and xprv / WIF / Solana-secret-length base58 are cut. An event
  that can't be scrubbed is dropped, never sent as is.
- **Services** (`services/{api,worker,indexer}/src/lib/sentry.ts`,
  `services/api/src/lib/log.ts`): a recursive field-name scrub on Sentry
  events and breadcrumbs, and Pino's `redact` list on log lines.

This is defence-in-depth — the wallet code never logs these in the first
place, but a third-party dependency could surface one in an error message or
a stack trace, so we intercept at the sink.

## Token storage — refresh + access tokens

**Current model** (deliberate, not an oversight):

- **Access token** (15-min JWT, HS256). Stored client-side via the platform's
  storage adapter (`localStorage` on web, `AsyncStorage` on mobile, etc.) and
  sent as `Authorization: Bearer <token>` on every request. Never accepted from
  a cookie. `requireAuth` also checks the token's session on every request
  (`services/api/src/lib/sessions.ts`), so logout or revoking a session cuts
  its access tokens off at once.
- **Refresh token** (30-day, random opaque string). Stored alongside the access
  token. Sent in the JSON body of `POST /auth/refresh`. Rotated on every use
  with a compare-and-swap on the presented token, so a stolen refresh token
  gets invalidated the moment the legitimate client refreshes, and two
  concurrent refreshes can't both succeed.
- **Refresh tokens are hashed in the database** (SHA-256 — appropriate here
  because refresh tokens are 48 random bytes, not low-entropy passwords;
  a slow KDF adds nothing against a 384-bit search space).
  A database leak therefore doesn't yield usable refresh tokens.

**Why not httpOnly cookies for refresh?** The wallet has four clients —
web, extension, desktop, mobile. Cookies are a web-only primitive; the other
three already use a unified storage adapter (`@thanos/api-client`'s
`StorageAdapter`). Adding a cookie path for web-only would split the surface,
require CORS + SameSite ceremony for cross-domain hosting, and gain nothing
the existing hardening doesn't already provide:

| Risk                          | Mitigation                                                |
| ----------------------------- | --------------------------------------------------------- |
| XSS exfiltrates tokens        | Nonce CSP on the wallet — no inline or injected script (`apps/web/lib/csp.js`, `middleware.ts`) |
| Token theft yields long access | Refresh rotates every use; access is 15 min and dies with its session |
| DB leak yields refresh tokens | Refresh tokens hashed SHA-256 server-side (high-entropy)  |
| Brute-force login             | `services/api/src/middleware/rate-limit.ts` (10 / 15 min) |
| Audit gap                     | `logAuthEvent()` writes every login / refresh / failure   |

If the project ever drops three of the four clients and goes web-only,
revisit this — cookies become a strict upgrade in that world.

## CSP — what scripts can do

- **Web wallet (`/app/*`)**: `apps/web/middleware.ts` sends a fresh nonce
  policy with every page — `script-src 'self' 'nonce-…' 'strict-dynamic'
  'wasm-unsafe-eval'`, no `'unsafe-inline'`, no `'unsafe-eval'` — and `/app`
  is rendered per request so Next stamps the nonce on its own scripts.
  Injected markup (an event-handler attribute, a `<script>` in the HTML)
  does not run. `apps/web/e2e/csp.spec.ts` enforces this.
- **Web public pages** (landing, docs, legal) are pre-rendered and
  shared-cached, so they can't carry a per-request nonce and keep
  `'unsafe-inline'`. They hold no keys, and links into the wallet are full
  page loads, so the wallet never runs under that policy.
- **One allow-list** for both: `apps/web/lib/csp.js`. Adding an upstream
  (RPC, bridge, API)? Add it to `connect-src` there — `lib/csp.test.ts`
  fails if a configured chain RPC isn't reachable.
- **Desktop**: the production renderer carries a meta CSP
  (`apps/desktop/vite.config.ts`): `script-src 'self' 'wasm-unsafe-eval'`.
  The in-app dApp browser is a separate, sandboxed view.
- **Extension**: MV3 `extension_pages` CSP (`apps/extension/wxt.config.ts`):
  `script-src 'self' 'wasm-unsafe-eval'`.

The bundles don't use `eval()` or `new Function()` in any production path
(the only such sites are guarded fallbacks); WebAssembly modules
(`tiny-secp256k1`, `hash-wasm`) load via `'wasm-unsafe-eval'`, the narrowest
permission that lets them run. If you add a new dependency and the CSP
starts blocking it, the right fix is usually to swap the dependency, not to
relax the CSP.

## Phishing — recipients, signing requests, sites

- **Send, on every client**: sdk-core `checkRecipient()` refuses the zero
  address and addresses on the scam list. The Send screens warn as the
  address is typed and refuse at submit — after resolving `name.litho` /
  `litho1…`, so a name can't hide a bad address.
- **Signing requests**: `reviewSigningRequest` blocks any request that
  involves a scam-list address (see *Signing* above).
- **Sites (web WalletConnect)**: `classifyOrigin()`
  (`apps/web/lib/phishing.ts`, an eth-phishing-detect subset) flags dApp
  origins: connecting to a flagged one needs an explicit acknowledgement,
  and a signing request from a critical one offers Reject only. (sdk-core's
  `inspectWebsite()` is not wired into any client.)

The scam list is `SCAM_ADDRESSES` in
`packages/sdk-core/src/security/sign-review.ts`. To add or remove an entry:

1. Edit it there **and** in the twins `apps/mobile/lib/sign-review.ts` and
   `apps/desktop/src/main/sign-review.ts` (kept identical below their
   headers; `packages/sdk-core/src/__tests__/sign-review.test.ts` runs its
   suite against all three).
2. Add a test pinning the verdict for the new entry.
3. Commit with a `security(phishing):` prefix so the change is greppable in
   the changelog.

The process is intentionally code-review-gated rather than
backend-administered — a malicious push to the API could otherwise quietly
add an allowlisted scam address. Keeping the list in versioned source code
puts every change through the PR security review.

A future expansion is to pull from a community-maintained feed (e.g.
EthScamDB) and merge at runtime — open question whether the latency hit and
the cross-feed conflict policy is worth it. Until then, manual + reviewed.

## Clipboard

Copying a recovery phrase or private key wipes the clipboard 60 s later
(desktop: from the main process, only if it still holds the secret, and on
quit; web / extension: sdk-core `copySecretToClipboard`; mobile:
`lib/secret-clipboard.ts`).

## Hardware-wallet device permissions

`apps/desktop/src/main/index.ts` restricts HID / USB device access via
`setDevicePermissionHandler` and `select-hid-device` to:

- Ledger USB vendor ID: `0x2c97`
- Trezor USB vendor IDs: `0x534c`, `0x1209`

Any other USB device asking for HID access is silently denied. This prevents
a malicious page from prompting the user to share a different USB device
(e.g. a keyboard) and harvesting keystrokes. The desktop dApp browser's
session denies every device, and the extension requests no HID access.

## Accepted-risk dependencies

`pnpm audit --audit-level=high --prod` runs on every PR and **fails the
build** on any high+ advisory not listed in `pnpm.auditConfig.ignoreGhsas`
(root `package.json`). Most high-severity transitive advisories are patched
via the `pnpm.overrides` block (axios, protobufjs, tar,
`@babel/plugin-transform-modules-systemjs`, etc.). The following are
**unfixable upstream** or unreachable, and the wallet team has accepted the
residual risk after review:

### `bigint-buffer ≤1.1.5` — buffer overflow in `toBigIntLE()` ([GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg))

- **No patch published.** Latest version on npm is 1.1.5; the maintainer
  has not released a fix. The override `bigint-buffer: ">=1.1.5"` is
  already at the latest available.
- **Where it's used:** transitively via `@solana/spl-token →
  @solana/buffer-layout-utils → bigint-buffer`. The Solana SPL-token
  client decodes account-data buffers returned by the Solana RPC.
- **Exploit surface:** an attacker would need to control the RPC
  response the wallet receives. The Solana RPCs are fixed HTTPS endpoints
  (`solana-rpc.publicnode.com`, falling back to `api.mainnet-beta.solana.com`);
  a successful exploit requires a TLS-level MITM against them.
- **Mitigation:** none beyond the existing HTTPS + endpoint pinning.
  Watch the [advisory page](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg)
  for a future patch; when one ships, bump the override + drop this entry.

### `image-size ≤2.0.2` — parser infinite loops ([GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq))

- **Where it's used:** only by Metro, the React Native bundler (pulled in
  through WalletConnect's optional React Native peers), which reads the
  project's own image assets at build time.
- **Exploit surface:** a denial of service needs a crafted ICNS / JXL / HEIF
  file in the repository's own assets. No client parses untrusted images
  with it.

### `node-forge ≤1.4.0` — RSA PKCS#1 v1.5 signature verification accepts extra nested DigestAlgorithm elements ([GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv))

- **No patch published** (advisory lists no fixed version; 1.4.0 is the
  latest on npm).
- **Where it's used:** only by developer tooling — React Native's dev
  server (`@react-native/dev-middleware → selfsigned`, reached through
  WalletConnect's optional React Native peers), `@expo/cli`,
  `@expo/code-signing-certificates` and `@devicefarmer/adbkit`. Overriding
  `selfsigned` to 5.x (which dropped node-forge) would not remove it.
- **Exploit surface:** none in shipped code. No workspace source imports
  node-forge, and the built web app, extension and desktop (renderer and
  main) bundles contain none of it (checked 2026-10-02). Forged-signature
  acceptance would matter only where node-forge verifies untrusted
  signatures at runtime, which no client does.
- **Mitigation:** none needed beyond keeping it out of runtime code. When a
  patched node-forge ships, add an override and drop this entry.

## Secrets, CI and the deployed environment

- `.env` is in `.gitignore`. Only `.env.example` is committed.
- `gitleaks-action@v2` runs on every PR (`.github/workflows/ci.yml`). Its
  allowlist (`.gitleaks.toml`) keeps one burned reviewer key only because it
  remains in git history — never fund that address.
- Every workflow installs with `pnpm install --frozen-lockfile`, so what
  ships is what the lockfile (and the SBOM) says.
- Production secrets (Sentry DSN, JWT secret, Slack webhook, PagerDuty key,
  database and Redis passwords) live in `/var/www/thanos-wallet/.env` on the
  VPS, root-only readable, never in git. The production compose overlay
  refuses to start without `POSTGRES_PASSWORD` / `REDIS_PASSWORD` instead of
  falling back to the dev defaults.

## Incident response

See `ops/backups/RUNBOOK.md` for the on-call playbook (DB restore, PITR,
cross-region failover). Sentry + Pino + Prometheus alerts wake the on-call
owner; the runbook is the source of truth for what to do next.

---

If you're about to weaken any of the above (relax CSP, log a redacted field
in the clear, accept a token from a cookie, etc.) — open an issue first and
get sign-off. Most security regressions in the field are well-intentioned
"temporary" debug paths that never get reverted.
