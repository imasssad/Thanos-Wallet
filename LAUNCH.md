# Launch checklist — Thanos Wallet v1.0

Paste-and-tick. The single sheet the operator works through to take
the wallet from "code complete on `main`" to "live on every platform."

Pairs with [`DEPLOYMENT.md`](./DEPLOYMENT.md) — that doc has the
*how*; this one is the *what's-done* tracker. Tick boxes as you go,
commit the ticks back so the team sees progress.

**Run `bash ops/verify.sh` any time** to compare your ticks against
reality (the script greens-out everything the repo already provides;
the boxes below are the remaining operator-side work).

---

## Phase 0 — accounts + certs (one-off; do these first because some
have approval delays)

- [ ] **Apple Developer Program** enrolled — $99/yr — 24-48h approval
  - [ ] Developer ID Application cert created (Keychain Access)
  - [ ] App-Specific Password generated at appleid.apple.com
  - [ ] App Store Connect API key (.p8) downloaded
  - [ ] Apple Team ID noted (Membership tab — 10-char string)
- [ ] **Google Play Developer Console** — $25 one-off
  - [ ] App created in Play Console (note the package name)
  - [ ] Service account JSON downloaded
- [ ] **Chrome Web Store dev account** — $5 one-off
- [ ] **Windows EV code-signing cert** — ~$400/yr from DigiCert / Sectigo (OPTIONAL for v1; skip if happy to ship unsigned `.exe`)
- [ ] **Sentry project** created at sentry.io (free tier works)
- [ ] **PagerDuty account** — free tier ≤ 5 users
- [ ] **Domain registrar access** confirmed (for DNS edits below)

## Phase 1 — VPS infrastructure (60 min, one-off)

- [ ] VPS provisioned (4 vCPU / 16 GB minimum)
- [ ] `git clone https://github.com/imasssad/Thanos-Wallet.git /var/www/thanos-wallet`
- [ ] `apt install docker.io docker-compose-plugin git curl jq` complete
- [ ] `.env` populated from `ops/secrets/prod.enc.env.template` (or SOPS — see ops/secrets/README.md)
- [ ] `bash scripts/setup-https.sh thanos.fi devs@thanos.fi` → HTTPS live
- [ ] `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`
- [ ] `curl -sf https://thanos.fi/api/health` returns `{"ok":true}`

## Phase 2 — Backups + observability

- [ ] `sudo bash ops/backups/install-cron.sh` → daily backup cron live
- [ ] `sudo SENTRY_DSN='https://…' bash ops/install-sentry.sh` → Sentry receiving events
- [ ] Synthetic exception fired + visible in Sentry (toggle SENTRY_DEBUG_ENDPOINT briefly)
- [ ] `docker compose -f ops/observability/docker-compose.observability.yml -f ops/observability/docker-compose.logs.yml -f ops/observability/docker-compose.uptime.yml up -d`
- [ ] Grafana reachable at http://127.0.0.1:3001 (admin password set)
- [ ] Uptime Kuma monitors configured per `docs/status-page-setup.md`
- [ ] PagerDuty integration key set + alert routes to it

## Phase 3 — Staging environment

- [ ] DNS `staging.thanos.fi` CNAME → VPS IP
- [ ] `cp scripts/nginx-staging.conf /etc/nginx/sites-available/thanos-wallet-staging`
- [ ] `certbot --nginx -d staging.thanos.fi`
- [ ] CI secrets added: `STAGING_SSH_HOST`, `STAGING_SSH_USER`, `STAGING_SSH_KEY`, `POSTGRES_PASSWORD_STAGING`, `REDIS_PASSWORD_STAGING`, `JWT_SECRET_STAGING`, `REFRESH_SECRET_STAGING`
- [ ] Push to `staging` branch → workflow green → staging.thanos.fi loads

## Phase 4 — Status page

- [ ] DNS `status.thanos.fi` CNAME → VPS IP
- [ ] nginx vhost for status page → 127.0.0.1:3002 (Uptime Kuma)
- [ ] `certbot --nginx -d status.thanos.fi`
- [ ] Status page configured per `docs/status-page-setup.md` (5 monitors, public page, notification channel)
- [ ] Public URL added to web app footer + store listings

## Phase 5 — Code-signing secrets (GitHub Actions)

In **Settings → Secrets and variables → Actions → New repository secret**:

- [ ] `CSC_LINK` — base64 of `Developer ID Application.p12`
- [ ] `CSC_KEY_PASSWORD` — the .p12 password
- [ ] `APPLE_ID` — Apple ID email
- [ ] `APPLE_APP_SPECIFIC_PASSWORD` — from appleid.apple.com
- [ ] `APPLE_TEAM_ID` — 10-char string
- [ ] `ASC_API_KEY_ID` + `ASC_API_KEY_ISSUER_ID` + `ASC_API_KEY_P8` (base64) — App Store Connect API key
- [ ] `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD` (skip if no Windows EV cert)
- [ ] `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT`
- [ ] `EXPO_TOKEN` — eas.dev token (write scope)

Verification: trigger a release run (push a `v1.0.0-rc.1` tag) — every job goes green, signed artifacts appear on the GitHub Release.

## Phase 6 — Mobile stores

### iOS

- [ ] `cd apps/mobile && eas build --platform ios --profile production`
- [ ] `eas submit --platform ios --profile production` → uploads to TestFlight
- [ ] In App Store Connect: app name + description from `apps/mobile/store-listing/ios.md` pasted
- [ ] Screenshots captured via `bash apps/mobile/scripts/capture-screenshots.sh` + uploaded
- [ ] App Privacy questionnaire filled (data collection = none)
- [ ] Build promoted from TestFlight → App Store review
- [ ] Approved + released to App Store

### Android

- [ ] `apps/mobile/credentials/play-service-account.json` placed (gitignored)
- [ ] `eas build --platform android --profile production`
- [ ] `eas submit --platform android --profile production` → uploads to Internal Testing
- [ ] Play Console listing copy from `apps/mobile/store-listing/android.md` pasted
- [ ] Screenshots uploaded
- [ ] Data safety form filled
- [ ] Content rating questionnaire complete
- [ ] Internal Testing → Production track
- [ ] Approved + released to Play Store

## Phase 7 — Browser extensions

### Chrome Web Store

- [ ] `pnpm --filter @thanos/extension zip` → fresh `.output/thanosextension-*-chrome.zip`
- [ ] Uploaded via https://chrome.google.com/webstore/devconsole
- [ ] Listing copy from `apps/extension/store/chrome-listing.md` pasted
- [ ] Screenshots from `pnpm --filter @thanos/web exec tsx scripts/capture-screenshots.ts` uploaded
- [ ] Privacy policy URL set to `https://thanos.fi/privacy`
- [ ] Permissions justifications filled
- [ ] Submitted for review
- [ ] Approved + listed

### Brave

- [ ] Brave indexes the Chrome listing — auto-listed within 48h of Chrome approval
- [ ] Listing visible at brave.com → wallet category

### Safari

- [ ] `pnpm --filter @thanos/extension build:safari` (on a Mac)
- [ ] `pnpm --filter @thanos/extension safari:convert` → Xcode project at `apps/extension/safari/xcode/`
- [ ] `APPLE_TEAM_ID=… pnpm --filter @thanos/extension safari:archive` → signed `.pkg`
- [ ] `xcrun altool --upload-app -f apps/extension/safari/build/export/*.pkg --apiKey $ASC_API_KEY_ID --apiIssuer $ASC_API_KEY_ISSUER_ID`
- [ ] In App Store Connect → submit for review
- [ ] Approved + listed

## Phase 8 — Desktop installers

- [ ] Tag `v1.0.0` → release workflow runs
- [ ] `Thanos Wallet-1.0.0.dmg` produced, signed, notarized (check: `bash apps/desktop/scripts/verify-signing.sh`)
- [ ] `Thanos Wallet Setup 1.0.0.exe` produced + (if Windows cert) signed
- [ ] Both attached to the GitHub Release
- [ ] Release Notes pasted from `CHANGELOG.md` v1.0.0 section
- [ ] SBOM `.json` files attached to the same release

## Phase 9 — Comms

- [ ] Privacy policy live at `https://thanos.fi/privacy` (publish `docs/privacy-policy.md`)
- [ ] Support docs live at `https://thanos.fi/support`
- [ ] Status page live at `https://status.thanos.fi`
- [ ] `/.well-known/security.txt` published at `https://thanos.fi/.well-known/security.txt` with PGP key
- [ ] Twitter / blog / launch-thread drafted
- [ ] Email sent to internal stakeholders with the launch window

## Phase 10 — Day-of

- [ ] **On-call owner set** for the launch window (PagerDuty rotation)
- [ ] **Backup on-call** identified + briefed
- [ ] **Post-launch monitoring window** scheduled (calendar invite, owners)
- [ ] Run `bash ops/verify.sh` one final time — expect 81 ✓ / 0 ⚠ / 0 ✗
- [ ] Push the launch tweet / blog post
- [ ] Watch Grafana "Service Health" + Sentry for the first 4 hours

---

## Aftermath — within 72h of launch

- [ ] Postmortem-worthy issues filed
- [ ] First Sentry triage pass
- [ ] First user-feedback batch reviewed
- [ ] Decision: ship a v1.0.1 within the week if any critical issues surfaced

---

## Cost summary

| Item | One-off | Annual |
|---|---|---|
| Apple Developer Program | $99 | $99 |
| Google Play Developer | $25 | — |
| Chrome Web Store | $5 | — |
| Windows EV cert (optional) | $0–400 | $0–400 |
| Domains (thanos.fi + subs) | $15 | $15 |
| VPS (4 vCPU / 16 GB) | — | $600–960 |
| Sentry / PagerDuty (free tiers) | — | $0 |
| **Total** | **$144–544** | **$714–1474** |

Drop the Windows EV cert if budget-sensitive — the unsigned `.exe`
still works for users, they just see a one-time SmartScreen prompt.
