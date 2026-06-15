# Store submission credentials

`eas.json`'s `submit.production` profiles read the two files below. They
are **gitignored** (see `.gitignore` here) — never commit them. Drop them
in locally before running `pnpm submit:*`, or store them as EAS secrets /
CI secrets for automated submission.

## iOS — App Store Connect API key

1. App Store Connect → **Users and Access → Integrations → App Store Connect API**.
2. Create a key with the **App Manager** role. Download the `.p8` ONCE
   (Apple only lets you download it a single time).
3. Save it here as **`asc-api-key.p8`**.
4. Note the **Key ID** and **Issuer ID** shown on that page, plus your
   **Team ID** (Membership page) and the **Apple ID** email of the account.

Set these for `eas submit` (env vars referenced by eas.json):

```
ASC_APPLE_ID=you@example.com
ASC_APP_ID=<numeric App Store app id, from the app's App Information page>
APPLE_TEAM_ID=XXXXXXXXXX
ASC_API_KEY_ID=XXXXXXXXXX
ASC_API_KEY_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

The app must already exist in App Store Connect (bundle id
`ai.thanos.wallet`) — create it once under **My Apps → +**.

## Android — Google Play service account

1. Google Play Console → **Setup → API access** (or Google Cloud console)
   → create a **service account**, grant it **Release manager** in Play.
2. Create a JSON key for that service account and download it.
3. Save it here as **`play-service-account.json`**.

The app must already exist in the Play Console (package
`ai.thanos.wallet`) with at least one manual upload, before automated
submission to the `production` track works.

## Where these get used

- Local: files in this folder → `pnpm --filter @thanos/mobile submit:ios|android`.
- CI: provide them as base64 GitHub secrets (`ASC_API_KEY_BASE64`,
  `PLAY_SERVICE_ACCOUNT_BASE64`) — the mobile-release workflow decodes
  them back into this folder at run time. See
  `.github/workflows/mobile-release.yml` and `store-listing/DEPLOY.md`.
