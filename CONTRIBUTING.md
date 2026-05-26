# Contributing to Thanos Wallet

Thanks for thinking about contributing. This is a real wallet that
holds real funds — so the bar is higher than typical open-source. The
notes below cover the bar.

## Tl;dr — first PR

1. Open an issue first if the change is more than a tiny fix. We
   want to align on the approach before you spend an evening on it.
2. Fork → branch → PR. CI must be green before review.
3. Touch crypto code (`vault.ts`, signer modules, key derivation)?
   Tag two reviewers and a 24-hour cool-off before merge.
4. Never commit a plaintext seed, password, or private key. Even in
   tests — use deterministic fixtures (see
   `packages/sdk-core/src/__tests__/mnemonic.test.ts` for an
   example using the known BIP-39 test vectors).

---

## Local setup

```bash
git clone https://github.com/imasssad/Thanos-Wallet.git
cd Thanos-Wallet
pnpm install                  # installs the whole workspace
# Mobile is workspace-detached:
(cd apps/mobile && pnpm install --ignore-workspace)
```

VS Code users: open the repo and accept the devcontainer prompt — it
sets up Node 20, pnpm, and the right TypeScript version automatically.

### Run the stack

```bash
docker compose up -d           # postgres + redis
pnpm --filter @thanos/api      dev
pnpm --filter @thanos/indexer  dev
pnpm --filter @thanos/worker   dev
pnpm --filter @thanos/web      dev   # → http://localhost:3000
```

For the extension: `pnpm --filter @thanos/extension dev` opens a
hot-reloading Chrome with the extension auto-installed.

For mobile:

```bash
cd apps/mobile
pnpm exec expo run:ios         # simulator (needs Xcode)
pnpm exec expo run:android     # emulator (needs Android Studio)
```

---

## Code style

We don't lint style — Prettier is the right tool for that and we'd
rather move fast than bikeshed. ESLint catches *bugs* (unused-vars,
react-hooks deps, dangerous patterns); see `eslint.config.js`.

- **TypeScript everywhere.** No `// @ts-ignore` without a comment
  explaining why.
- **No emojis in code** unless a UI component explicitly renders one.
- **Comments explain WHY**, not what. Well-named identifiers cover
  the what.
- **Defaults: short.** Prefer one short clear line over three
  defensive checks.

### Tests

The test pyramid here is:
- **Unit tests** in `packages/sdk-core/src/__tests__/` for any pure
  function (vault, address derivation, fee math, phishing rules).
- **Integration tests** in `services/api/src/__tests__/` against a
  real Postgres service container (see the `test` job in
  `.github/workflows/ci.yml`).
- **E2E tests** in `apps/web/e2e/` driving a built Next.js prod
  bundle through Playwright. Run locally with
  `pnpm --filter @thanos/web exec playwright test`.

Don't ship code that touches:
- Vault / key derivation
- Send/sign paths
- Auth routes
- LEP-100 client

without a unit or integration test. The reviewer will ask.

---

## Security

Crypto/auth changes are reviewed against this checklist:

1. Are seeds / passwords / private keys ever logged, sent over the
   network, or stored in plaintext? If yes, the PR is rejected.
2. Are the Pino `redact` paths still complete? Add the new field
   name if you introduce one.
3. Does signing happen inside the isolation boundary (Worker /
   offscreen / main-process / module-private), not in the UI thread?
4. Is there a test that asserts the property your code guarantees?
   E.g. "decryption with the wrong password returns `null`, not
   throws."

If you find a vulnerability **don't open an issue.** Email
security@thanos.fi (PGP key at thanos.fi/.well-known/security.txt)
or use the GitHub Security tab → "Report a vulnerability."

---

## Commit hygiene

Conventional Commits, loosely. Pattern:

```
<type>(<scope>): <subject>

<body explaining the WHY>
```

- `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `ops`, `security`
- `scope` matches an app or package: `web`, `extension`, `desktop`,
  `mobile`, `sdk-core`, `api`, `indexer`, `worker`.

Examples that make a reviewer's life easy:
- `feat(extension): offscreen signer — popup no longer holds keys`
- `fix(sdk-core): handle 0-value LEP-100 transfers without revert`
- `security(api): widen Pino redact to cover refresh_token_hash`

Things to avoid:
- One-PR-many-concerns
- Re-formatting an unrelated file in the same PR (CI lints style
  separately; pure-format PRs are fine, but mixed is not)
- `--amend` after a reviewer has commented — they lose their place

---

## Reviewing PRs

If you have CODEOWNERS access:

1. Read the description before the diff. If the WHY isn't clear,
   ask before reviewing line-by-line.
2. Run the branch locally for anything UI / signing.
3. Comments are not orders — push back if you disagree, but suggest
   an alternative.
4. Approve as soon as you'd accept the merge. Holding up "for one
   more pass" wastes everyone's time.

---

## Project layout

```
apps/             every client surface (web / extension / desktop / mobile)
packages/sdk-core every chain client + security primitive shared across clients
services/         backend (api / indexer / worker / db schema)
ops/              compose files, observability stack, secrets, runbooks
docs/             privacy policy, incident runbook, scaling policy, …
scripts/          nginx, certbot, signing helpers
```

A PR usually touches at most three of those. If it touches all of
them, it's almost certainly two PRs.

---

## Need help?

- Architecture questions → open a draft PR with what you have, ask
  in the description.
- Stuck on something specific → `#thanos-dev` Slack (DM the
  maintainer for an invite).
- Just want to file a bug → see the issue templates.
