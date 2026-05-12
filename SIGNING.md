# Release Signing & Secrets

This file documents every credential we need to ship Thanos Wallet builds.
None of these belong in the repo — they live in 1Password (vault: `thanos-release`)
and are mirrored into the relevant CI environments as listed below.

> **Rule of thumb:** if a secret in this file changes, also rotate it in
> 1Password *and* the CI environment that references it. We will not commit
> a key, cert, or password to git under any circumstances.

---

## 1. Web — `apps/web` (Next.js, deployed to VPS via Docker)

### GitHub Actions secrets (repo: thanos-wallet)

| Secret                  | What it is                                      | Used by                  |
|-------------------------|-------------------------------------------------|--------------------------|
| `VPS_SSH_HOST`          | VPS hostname / IP (e.g. `76.13.250.159`)        | `.github/workflows/deploy.yml` |
| `VPS_SSH_USER`          | Username on the VPS (`root` or `deploy`)        | deploy.yml               |
| `VPS_SSH_PRIVATE_KEY`   | PEM body of the SSH key with VPS access         | deploy.yml               |

### Runtime env (VPS `.env`, mounted via docker-compose.prod.yml)

| Variable                       | Source                                              |
|--------------------------------|-----------------------------------------------------|
| `NEXT_PUBLIC_LITHO_RPC`        | `https://rpc.litho.ai`                              |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | Reown dashboard — currently `6d05d9a8…a18c81`       |
| `NEXT_PUBLIC_MULTX_API_URL`    | `https://bridge.litho.ai`                           |
| `NEXT_PUBLIC_SENTRY_DSN`       | Sentry project `thanos-wallet-web` — Client Keys     |
| `SENTRY_AUTH_TOKEN`            | Sentry → User → Auth Tokens (scope: `project:write`) — only set in CI for sourcemap upload |
| `SENTRY_ORG`                   | `thanos` (Sentry slug)                              |
| `SENTRY_PROJECT`               | `thanos-wallet-web`                                 |

`next.config.js` only wraps the build with `withSentryConfig` when **both**
`SENTRY_AUTH_TOKEN` and `NEXT_PUBLIC_SENTRY_DSN` are set, so local builds and
PR previews don't need any of these.

---

## 2. Desktop — `apps/desktop` (Electron, electron-builder)

Code signing is required for Gatekeeper (macOS) and SmartScreen (Windows) to
not flag every install. Without it, users see "unidentified developer" or
"Windows protected your PC" prompts.

### macOS — Apple Developer ID

We use a **Developer ID Application** certificate (NOT a Mac App Store one).

| Variable                       | What it is                                                   |
|--------------------------------|--------------------------------------------------------------|
| `CSC_LINK`                     | Base64 of the `.p12` exported from Keychain (Developer ID)   |
| `CSC_KEY_PASSWORD`             | Passphrase used when exporting the `.p12`                    |
| `APPLE_ID`                     | Apple ID email used for the Developer Program account        |
| `APPLE_APP_SPECIFIC_PASSWORD`  | App-specific password generated at appleid.apple.com         |
| `APPLE_TEAM_ID`                | 10-char team ID from the Apple Developer portal              |

electron-builder will:
1. Sign every Mach-O binary with the Developer ID cert (`CSC_LINK`)
2. Submit the resulting `.dmg` / `.zip` to Apple's notarization service
   (`APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD`)
3. Staple the notarization ticket so Gatekeeper trusts the app offline

### Windows — EV Code Signing Certificate

We use an **EV cert** because SmartScreen reputation is established instantly
with EV, vs. weeks of installs needed for a regular OV cert.

| Variable                  | What it is                                                  |
|---------------------------|-------------------------------------------------------------|
| `CSC_LINK`                | Base64 of the `.pfx` (or path to the HSM driver)            |
| `CSC_KEY_PASSWORD`        | PFX passphrase, or HSM PIN                                  |
| `WIN_CSC_LINK`            | Optional override when both mac+win sign in the same job    |
| `WIN_CSC_KEY_PASSWORD`    | Optional override                                            |

If the EV cert is on a YubiKey / HSM, the signing call has to run on a
self-hosted Windows runner with the device attached — GitHub-hosted runners
can't access USB tokens. `build/sign.js` is the hook electron-builder calls
per-binary; populate it with the signtool invocation for the HSM in use.

### Linux

No signing needed for AppImage / `.deb` — we publish SHA-256 hashes alongside
the binaries and let users verify manually.

---

## 3. Mobile — `apps/mobile` (React Native via Expo / EAS)

### EAS Build secrets (Expo project `thanos-wallet`)

| Secret                      | Used for                                                       |
|-----------------------------|---------------------------------------------------------------|
| `EXPO_TOKEN`                | CLI auth, exposed to CI as `EXPO_TOKEN`                       |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Submitted automatically by `eas submit -p ios` |
| `ASC_API_KEY_ID`, `ASC_API_KEY_ISSUER_ID`, `ASC_API_KEY` | App Store Connect API key (preferred over Apple ID password)   |
| Android Keystore            | Managed automatically by EAS (recoverable from EAS dashboard) |
| `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` | Service-account JSON for Play Console internal-track submissions |

iOS provisioning profiles are managed by EAS — we do *not* need to keep them
in 1Password as long as the Apple ID + ASC API key are present.

---

## 4. Extension — `apps/extension` (WXT + WebExtension)

Chrome Web Store and Firefox AMO each have their own signing flow that runs
as part of the listing-update CI job (not in this repo's `release.yml` yet —
TODO once the listings are live).

| Secret                           | Where it goes                                                |
|----------------------------------|-------------------------------------------------------------|
| `CHROME_EXTENSION_ID`            | Set by CWS on first upload                                  |
| `CHROME_CLIENT_ID`               | OAuth2 client ID for Chrome Web Store API                   |
| `CHROME_CLIENT_SECRET`           | OAuth2 client secret                                         |
| `CHROME_REFRESH_TOKEN`           | Refresh token for the publisher account                     |
| `FIREFOX_JWT_ISSUER`             | AMO API key (issuer)                                         |
| `FIREFOX_JWT_SECRET`             | AMO API key (secret)                                         |

---

## 5. Backend services — `services/indexer`, `services/api`

| Secret                       | What it is                                          |
|------------------------------|-----------------------------------------------------|
| `DATABASE_URL`               | Postgres connection string, set on the VPS only     |
| `MAKALU_RPC_URL`             | Defaults to `https://rpc.litho.ai`; can be overridden to a private node for indexer throughput |
| `MAKALU_LEP100_*_ADDRESS`    | Per-token contract addresses (LITHO, IMAGE, JOT, …) — read by `services/indexer/src/chain.ts` |

---

## Rotation playbook

When a secret leaks or an engineer rolls off the project:

1. Rotate the source-of-truth credential (Apple, Sentry, Reown, VPS, …)
2. Update the value in 1Password (`thanos-release` vault)
3. Re-set it in every CI environment listed above — GitHub repo settings,
   EAS dashboard, VPS `.env`
4. Trigger a smoke build of every client to confirm the new credentials work
5. Commit a one-line CHANGELOG entry noting the rotation date (no secret values)
