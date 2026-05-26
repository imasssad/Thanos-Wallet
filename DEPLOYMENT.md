# Deployment — single-source operator launch sequence

Every step from "fresh VPS + empty dev accounts" to "all clients live
in their stores." Linearised so the operator can paste, verify, and
move on. Each section ends with a one-line check that should pass.

If you only have 15 minutes and want to verify the current state,
skip to the bottom and run `bash ops/verify.sh`.

---

## Pre-flight (5 min)

```bash
git clone https://github.com/imasssad/Thanos-Wallet.git /var/www/thanos-wallet
cd /var/www/thanos-wallet
git checkout main
git pull
```

Check: `git rev-parse HEAD` → matches the latest sha on GitHub.

---

## Step 1 — VPS infrastructure (60 min, one-off)

### 1.1 — System packages

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git curl jq
sudo usermod -aG docker $USER && newgrp docker
```

Check: `docker compose version` prints v2.x.

### 1.2 — Environment file

```bash
cd /var/www/thanos-wallet
cp .env.example .env
nano .env   # fill the values per the comments in .env.example
```

Required values (the rest have defaults):
- `POSTGRES_PASSWORD` — random 32-char string (`openssl rand -hex 16`)
- `JWT_SECRET` — random 64-char string
- `REFRESH_SECRET` — random 64-char string (different from JWT_SECRET)
- `GRAFANA_ADMIN_PASSWORD` — operator's password for the dashboards

Check: `grep -c "=.\+$" .env` ≥ 8 (i.e. at least 8 vars are non-empty).

### 1.3 — TLS

```bash
sudo bash scripts/setup-https.sh thanos.fi devs@thanos.fi
```

Check: `curl -sI https://thanos.fi/` returns `200`.

### 1.4 — Bring the stack up

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
docker compose ps   # every service Up / healthy
```

Check: `curl -sf https://thanos.fi/api/health | jq .ok` → `true`.

### 1.5 — Daily Postgres backup

```bash
sudo bash ops/backups/install-cron.sh
```

Check: `sudo crontab -l | grep pg-backup` shows the registered line.

### 1.6 — Observability + uptime

```bash
docker compose -f ops/observability/docker-compose.observability.yml \
  -f ops/observability/docker-compose.logs.yml \
  -f ops/observability/docker-compose.uptime.yml \
  up -d
```

Then SSH-tunnel to set up Kuma monitors per `docs/status-page-setup.md`.

Check: `curl -sf http://127.0.0.1:9090/-/ready` (prometheus) returns 200.

---

## Step 2 — Sentry (15 min, one-off)

1. Create the project at https://sentry.io (free tier covers small wallets).
   Pick "Node.js" platform, name it `thanos-wallet-backend`.
2. Copy the DSN.
3. On the VPS:

```bash
sudo SENTRY_DSN='https://<id>@sentry.io/<project>' bash ops/install-sentry.sh
```

4. Verify with the synthetic-exception endpoint:

```bash
sudo SENTRY_DEBUG_ENDPOINT=1 bash ops/install-sentry.sh   # turn on the test route
curl -X POST https://thanos.fi/api/debug/sentry-test       # fire the exception
# Sentry dashboard should show the event within 30s.
sudo SENTRY_DEBUG_ENDPOINT=0 bash ops/install-sentry.sh   # turn it off
```

Check: synthetic exception visible in Sentry, then `/debug/sentry-test` returns 404 after toggle-off.

---

## Step 3 — Apple Developer Program ($99/yr, 24-48h account approval)

1. Enrol at https://developer.apple.com/programs/enroll/
2. Once approved, create the certificates:
   - **Developer ID Application** (.cer + private key in Keychain Access on a Mac)
   - **Developer ID Installer** (same)
3. Export both as `.p12` from Keychain Access, base64-encode:
   ```bash
   base64 -i DeveloperIDApplication.p12 > CSC_LINK.txt
   ```
4. Add to the GitHub repo's secrets:
   - `CSC_LINK` — paste of `CSC_LINK.txt`
   - `CSC_KEY_PASSWORD` — the .p12 password
   - `APPLE_ID` — your Apple ID email
   - `APPLE_APP_SPECIFIC_PASSWORD` — generate at https://appleid.apple.com → App-Specific Passwords
   - `APPLE_TEAM_ID` — 10-char team id from https://developer.apple.com/account → Membership
5. Create an App Store Connect API key (https://appstoreconnect.apple.com/access/api):
   - Download the `.p8` file (one-time download, save it)
   - Add to GitHub secrets: `ASC_API_KEY_ID`, `ASC_API_KEY_ISSUER_ID`, and `ASC_API_KEY_P8` (base64 of the .p8 file)

Check: trigger a release run on GitHub Actions; the `desktop-macos` job should produce a `.dmg` AND log "Notarization successful" from electron-builder.

---

## Step 4 — Windows EV code-signing cert ($300-500/yr from DigiCert or Sectigo, 1-3 days)

1. Buy the cert. Some vendors ship a USB HSM (token); cheaper providers ship a `.pfx` you can import.
2. If you got a `.pfx`:
   ```bash
   base64 -i ThanosCert.pfx > WIN_CSC_LINK.txt
   ```
   Add to GitHub secrets:
   - `WIN_CSC_LINK` — paste of `WIN_CSC_LINK.txt`
   - `WIN_CSC_KEY_PASSWORD` — the .pfx password
3. If you got a USB HSM, you can't run the signing in GitHub Actions —
   you'll need a self-hosted runner with the token plugged in. See
   `SIGNING.md` for the alternative flow.

Check: GitHub Actions `desktop-windows` job emits a signed `.exe`;
`signtool verify /pa /v thanos-wallet-Setup-1.0.0.exe` returns
"Successfully verified."

---

## Step 5 — Mobile stores

### 5.1 — Apple App Store (with the certs from Step 3)

```bash
cd apps/mobile
eas login                                      # one-time
eas build --platform ios --profile production
eas submit --platform ios --profile production # auto-uploads to TestFlight
```

Then in App Store Connect: add screenshots (capture script in
`apps/mobile/store-listing/README.md`), description (copy from
`apps/mobile/store-listing/ios.md`), submit for review.

### 5.2 — Google Play Console ($25 one-off)

1. Enrol at https://play.google.com/console
2. Create the app → Internal Testing track → grab the package name
3. Create a service account with Release Manager role:
   - Google Cloud Console → IAM & Admin → Service Accounts → Create
   - Download the JSON
   - Save as `apps/mobile/credentials/play-service-account.json` (gitignored)
4. Build + submit:
   ```bash
   cd apps/mobile
   eas build --platform android --profile production
   eas submit --platform android --profile production
   ```
5. In Play Console: screenshots, listing copy from
   `apps/mobile/store-listing/android.md`, Data safety form, submit.

Check: app appears in TestFlight / Internal Testing within 24h.

---

## Step 6 — Browser extensions

### 6.1 — Chrome Web Store ($5 one-off)

1. Enrol at https://chrome.google.com/webstore/devconsole ($5 lifetime fee).
2. Upload the latest Chrome zip:
   ```bash
   pnpm --filter @thanos/extension zip
   # Drag .output/thanosextension-*-chrome.zip into the dev console.
   ```
3. Fill the listing using `apps/extension/store/chrome-listing.md`.
4. Add screenshots — capture via:
   ```bash
   pnpm --filter @thanos/web exec tsx scripts/capture-screenshots.ts
   ```
5. Click "Submit for review."

### 6.2 — Brave Store

Brave indexes the Chrome listing. Once Chrome approves, your extension
shows up there too. No separate submission for v1.

### 6.3 — Safari (needs an Apple Developer cert from Step 3)

```bash
pnpm --filter @thanos/extension build:safari
pnpm --filter @thanos/extension safari:convert
APPLE_TEAM_ID=ABC123XYZ \
  pnpm --filter @thanos/extension safari:archive
xcrun altool --upload-app \
  -f apps/extension/safari/build/export/*.pkg \
  --apiKey "$ASC_API_KEY_ID" --apiIssuer "$ASC_API_KEY_ISSUER_ID"
```

Then in App Store Connect → Safari extension app → submit.

---

## Step 7 — DNS for status page

CNAME `status.thanos.fi` → your VPS IP. Then add an nginx vhost
terminating SSL and proxying to `127.0.0.1:3002` (Uptime Kuma).
Template in `scripts/HTTPS_RUNBOOK.md`.

Check: `curl -sI https://status.thanos.fi/` returns 200 + cert is
valid.

---

## Step 8 — On-call rotation (PagerDuty or Opsgenie)

1. Create a PagerDuty account (free tier ≤ 5 users).
2. Add the team — primary + backup on-call.
3. Wire the integration:
   - Set `PAGERDUTY_INTEGRATION_KEY` in the VPS `.env`
   - Restart the alertmanager: `docker restart thanos-alertmanager`
4. Test by triggering an alert (e.g. `docker stop thanos-api`).

Check: PagerDuty page fires within 2 minutes of the synthetic outage,
then resolves once the container restarts.

---

## Pre-flight verification — run this anytime

```bash
bash ops/verify.sh
```

Prints a status table. Green rows = ✅ live. Yellow = configured but
not verified end-to-end. Red = missing.

---

## Operational rhythm — what to do every week

1. **Monday** — check Grafana "Service Health" dashboard for the
   weekend. Address any unresolved alerts.
2. **Tuesday** — review the Sentry "new issues" panel; triage.
3. **Wednesday** — run `bash ops/verify.sh` to catch drift.
4. **Friday** — check the previous week's pg backups via
   `ls -lh /var/backups/thanos-wallet/daily/`; expect 7 files of
   roughly similar size.

---

## When something breaks

- `docs/incident-runbook.md` — what to do at 3 a.m.
- `ROLLBACK.md` — how to back out a bad deploy.
- `docs/status-page-setup.md` — how to communicate the outage.
- `ops/backups/RUNBOOK.md` — DB restore from backups.

---

## Cost summary (one-off + recurring)

| Item | One-off | Recurring |
|---|---|---|
| Apple Developer Program | $99 | $99/yr |
| Chrome Web Store | $5 | — |
| Google Play Console | $25 | — |
| Windows EV cert | ~$400 | ~$400/yr |
| VPS (4 vCPU / 16 GB) | — | $50-80/mo |
| Domain (thanos.fi) | $15 | $15/yr |
| Sentry (free tier) | — | $0 |
| PagerDuty (free tier ≤5 users) | — | $0 |
| **Total** | **~$130 + ~$400 (Windows cert)** | **~$80/mo + $510/yr** |

Drop the Windows cert if you can ship the wallet unsigned on Windows
(the .exe still works, users just see SmartScreen's "unrecognised
publisher" the first time they run it). That's a $400 one-off + $400/yr
saving for a v1 launch.
