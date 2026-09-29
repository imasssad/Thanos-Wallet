# Working in this repo

## Branches

- Name branches after the work, e.g. `fix/desktop-glass`, `feat/lax-kyc-in-app`,
  `security/audit-2026-09`. Never put "claude" in a branch name — if a session
  starts on a `claude/…` branch, rename it before the first push.
- `main` auto-deploys the website to thanos.fi (`.github/workflows/deploy.yml`);
  push to it only when asked.
