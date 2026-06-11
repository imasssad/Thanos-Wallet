# Security model

This document records the deliberate security choices in Thanos Wallet so future
contributors don't undo them. For incident-response procedures see
`ops/backups/RUNBOOK.md`; for observability + alert routing see `OBSERVABILITY.md`.

---

## Vault — what protects the user's seed

- **Encryption-at-rest**: AES-256-GCM with a unique random IV per vault.
- **Key derivation**: Argon2id (`t=3, m=64MB, p=4`) keyed off the user's
  password. Per-vault random 16-byte salt. The same parameters run client-side
  (`apps/web/lib/vault.ts`, `apps/extension/src/lib/vault.ts`,
  `apps/desktop/src/main/keyvault.ts`, `apps/mobile/lib/vault.ts`) and
  server-side for the optional cloud-sync slice (`services/api/src/lib/argon2.ts`).
- **Mnemonic never leaves the device.** No client ever serializes the seed or
  the derived private key into an API call. The vault sits in `localStorage` /
  `expo-secure-store` / `safeStorage` — never the network.
- **Session key cache** is in memory only and cleared on lock + on tab close.

## Logging — what we never write

`apps/web/sentry.client.config.ts` and `services/api/src/lib/log.ts` redact, via
recursive `beforeSend` + Pino's `redact` list:

```
/(mnemonic|password|seed|private[_-]?key|vault|session[_-]?key|token|authorization)/i
```

Every Sentry event + every Pino log line is walked before send. The redaction
is defence-in-depth — the wallet code never logs these in the first place, but a
third-party dependency could accidentally surface one in a stack trace, so we
intercept at the sink.

## Token storage — refresh + access tokens

**Current model** (deliberate, not an oversight):

- **Access token** (15-min JWT, HS256). Stored client-side via the platform's
  storage adapter (`localStorage` on web, `AsyncStorage` on mobile, etc.) and
  sent as `Authorization: Bearer <token>` on every request. Never accepted from
  a cookie.
- **Refresh token** (30-day, random opaque string). Stored alongside the access
  token. Sent in the JSON body of `POST /auth/refresh`. Rotated on every use
  (`services/api/src/routes/auth.ts` line 217+) so a stolen refresh token gets
  invalidated the moment the legitimate client refreshes.
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
| XSS exfiltrates tokens        | Strict CSP without `unsafe-eval` (`apps/web/next.config.js`) |
| Token theft yields long access | Refresh rotates every use; access is 15 min               |
| DB leak yields refresh tokens | Refresh tokens hashed SHA-256 server-side (high-entropy)  |
| Brute-force login             | `services/api/src/middleware/rate-limit.ts` (10 / 15 min) |
| Audit gap                     | `logAuthEvent()` writes every login / refresh / failure   |

If the project ever drops three of the four clients and goes web-only,
revisit this — cookies become a strict upgrade in that world.

## CSP — what scripts can do

`apps/web/next.config.js` ships a Content-Security-Policy with **no
`unsafe-eval`**. The bundle does NOT use `eval()` or `new Function()` in any
production path. Web-Assembly modules (used by `tiny-secp256k1` for BIP32
derivation) load via `wasm-unsafe-eval`, which is the narrowest permission
that lets the WASM run.

If you add a new dependency and the CSP starts blocking it, the right fix is
usually to swap the dependency, not to relax the CSP.

## Phishing — recipient classification + allowlist/blocklist process

The wallet runs every send-recipient address through
`packages/sdk-core/src/security/phishing.ts` before the user can sign. Verdicts
are `safe | caution | warning | critical`; a `critical` verdict blocks the
Send button entirely.

The blocklist is currently a hardcoded set inside the module
(`blockedKeywords` + `suspiciousTlds` + known scam-address prefixes). To add
or remove an entry:

1. Open `packages/sdk-core/src/security/phishing.ts`.
2. Edit the relevant array (keyword, TLD, or address).
3. Add a unit test in `packages/sdk-core/src/__tests__/phishing.test.ts`
   pinning the classification result for the new entry.
4. Commit with a `security(phishing):` prefix so the change is greppable in
   the changelog.

The process is intentionally code-review-gated rather than
backend-administered — a malicious push to the API could otherwise quietly
add an allowlisted scam address. Keeping the list in versioned source code
puts every change through the PR security review.

A future expansion is to pull from a community-maintained feed (e.g.
EthScamDB) and merge at runtime — open question whether the latency hit and
the cross-feed conflict policy is worth it. Until then, manual + reviewed.

## Hardware-wallet device permissions

`apps/desktop/src/main/main.ts` and `apps/extension/src/entrypoints/background.ts`
both restrict WebHID device access via `setDevicePermissionHandler` to:

- Ledger USB vendor IDs: `0x2c97`
- Trezor USB vendor IDs: `0x534c`, `0x1209`

Any other USB device asking for HID access is silently denied. This prevents
a malicious page from prompting the user to share a different USB device
(e.g. a keyboard) and harvesting keystrokes.

## Accepted-risk dependencies

`pnpm audit --audit-level=high --prod` is run on every PR. Most
high-severity transitive advisories are patched via the `pnpm.overrides`
block in the root `package.json` (axios, protobufjs, tar,
`@babel/plugin-transform-modules-systemjs`, etc.). The following one is
**unfixable upstream** and the wallet team has accepted the residual risk
after review:

### `bigint-buffer ≤1.1.5` — buffer overflow in `toBigIntLE()` ([GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg))

- **No patch published.** Latest version on npm is 1.1.5; the maintainer
  has not released a fix. The override `bigint-buffer: ">=1.1.5"` is
  already at the latest available.
- **Where it's used:** transitively via `@solana/spl-token →
  @solana/buffer-layout-utils → bigint-buffer`. The Solana SPL-token
  client decodes account-data buffers returned by the Solana RPC.
- **Exploit surface:** an attacker would need to control the RPC
  response the wallet receives. Our RPC endpoints are pinned to
  `api.mainnet-beta.solana.com` (production) over HTTPS; a successful
  exploit requires a TLS-level MITM against Solana's hosted RPC.
- **Mitigation:** none beyond the existing HTTPS + endpoint pinning.
  Watch the [advisory page](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg)
  for a future patch; when one ships, bump the override + drop this entry.

The CI `dependency audit (high+)` job is configured with
`continue-on-error: true` so this single unfixable advisory does not
gate PRs. When upstream patches it, flip the job back to a hard fail.

## Secrets in CI + the deployed environment

- `.env` is in `.gitignore`. Only `.env.example` is committed.
- `gitleaks-action@v2` runs on every PR (`.github/workflows/ci.yml`).
- `pnpm audit --audit-level=high --prod` runs on every PR.
- Production secrets (Sentry DSN, JWT secret, Slack webhook, PagerDuty key)
  live in `/var/www/thanos-wallet/.env` on the VPS, root-only readable, never
  in git.

## Incident response

See `ops/backups/RUNBOOK.md` for the on-call playbook (DB restore, PITR,
cross-region failover). Sentry + Pino + Prometheus alerts wake the on-call
owner; the runbook is the source of truth for what to do next.

---

If you're about to weaken any of the above (relax CSP, log a redacted field
in the clear, accept a token from a cookie, etc.) — open an issue first and
get sign-off. Most security regressions in the field are well-intentioned
"temporary" debug paths that never get reverted.
