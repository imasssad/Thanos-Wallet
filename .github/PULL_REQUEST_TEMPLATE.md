<!--
  Thanos Wallet — Pull Request template.

  Quick rules:
  - One PR = one concern. Refactors + features in the same PR make
    review harder.
  - Keep the description focused on the WHY. The diff already shows
    the what.
  - Tick the relevant boxes; delete the rest of the template if
    they don't apply.

  This template auto-fills on every PR.
-->

## What this PR does



## Why



<!-- Optional: link the issue / Linear ticket this closes. -->
Closes #

---

## Verification

How did you check this works? Tick at least one.

- [ ] `pnpm typecheck` passes locally
- [ ] `pnpm lint` passes locally
- [ ] Affected unit tests run green (`pnpm --filter <pkg> test`)
- [ ] Affected E2E specs run green (`pnpm --filter @thanos/web exec playwright test`)
- [ ] Manually walked through the new flow in: <web / extension / desktop / mobile>
- [ ] Re-ran `bash ops/verify.sh` — no new red rows

## Scope of the change

Tick all that apply.

- [ ] Web app
- [ ] Browser extension
- [ ] Desktop app
- [ ] Mobile app
- [ ] Shared sdk-core
- [ ] Backend services (api / indexer / worker)
- [ ] DB schema or migration
- [ ] Ops / infra / CI
- [ ] Docs only

## Risk assessment

- [ ] Touches cryptographic code (vault, signers, key derivation) — **needs a second reviewer**
- [ ] Modifies user-visible UI — included a screenshot
- [ ] Adds a new dependency — checked `pnpm audit --high --prod` is clean
- [ ] Changes an existing API contract — listed the breakage below
- [ ] None of the above; routine change

<!-- If any of the first four are checked, explain here. -->

## Breaking changes



## Screenshots / GIFs

<!-- Drop a screenshot when the PR touches anything visible. -->

---

<sub>By submitting this PR you confirm it was authored by a human + complies with the project's secrets-handling rules (no plaintext seeds, passwords, or private keys committed).</sub>
