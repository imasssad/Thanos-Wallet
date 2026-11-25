# Thanos Wallet — audit candidate status (2026-10-20)

**Candidate:** `main` at `f8e5f2f0` (2026-10-18, "extension 1.0.15"). CI green at that
commit: `ci` [39149854650](https://github.com/imasssad/Thanos-Wallet/actions/runs/39149854650),
`sbom` [39149854620](https://github.com/imasssad/Thanos-Wallet/actions/runs/39149854620).
The package (`scripts/audit-package.sh`) records everything it ran in its own README.

The last whole-wallet review is the 2026-09-27 hardening audit
(`docs/audit/2026-09-27/HARDENING-AUDIT.md`, status as of 2026-09-28, commit `6cc88ee4`).
This note says where its findings stand at the candidate, and what has changed since.

## 2026-09-27 findings at `f8e5f2f0`

The items marked **Fixed** were not re-reviewed one by one. Where code they cover has changed
since (the extension's connection handling, F-2 / F-3), the protection was checked and is in
place: `accountsChanged` still goes only to tabs on connected origins
(`apps/extension/src/entrypoints/background.ts:406-418`). The items that were open are
unchanged; each was checked in the code at this commit:

| ID | Sev | Status at `f8e5f2f0` | Checked |
|---|---|---|---|
| H-1 | High | **Open.** The seed is still held in UI-thread / renderer state on every client while unlocked. | e.g. `apps/desktop/src/renderer/main.tsx` keeps `walletSeed` in React state |
| H-2 | High | **Partly fixed**, as on 09-28: nonce CSP on `/app`; the raw session key is still in `sessionStorage`. | `apps/web/lib/vault.ts:793` |
| H-5 | High | Fixed in the repository; **rotating the burned reviewer key is an owner action** and can't be confirmed from the code. | — |
| M-1 | Med | **Open — decision.** PBKDF2 floor 10,000; keychain class `AFTER_FIRST_UNLOCK`. | `apps/mobile/lib/vault.ts:68, 158` |
| M-3 | Med | **Open — decision.** Biometric unlock is a prompt gate, not bound to the key. | `apps/mobile/lib/biometric.ts` |
| M-6 | Med | **Open.** `POST /push/register` is still unauthenticated. | `services/api/src/routes/push.ts:27` |
| M-7 | Med | **Open — partner.** Static shared webhook secret, no HMAC or replay window. | `services/api/src/routes/lax.ts` |
| L-2 | Low | **Open.** `/auth/register` answers 409 for a registered email. | `services/api/src/routes/auth.ts:92` |
| L-5 | Low | **Partly fixed.** The audit job blocks; all 9 third-party actions are still pinned to tags. | `.github/workflows/*` |
| L-10 | Low | Open — by design. | — |
| L-11 | Low | **Open.** `ignoreBuildErrors` / `ignoreDuringBuilds` in the web build. | `apps/web/next.config.js:47, 49` |

The 09-28 observations also still apply (the extension advertises `eth_signTransaction` to
WalletConnect without a handler; the web e2e suite is not run in CI).

Dependency advisories accepted since then, with the reachability analysis in `SECURITY.md`:
node-forge GHSA-86w9-cpqp-85rv (`f9a5aca7`) and braces GHSA-vfj7-8cjw-p6xm (`6179f3db`), both
reachable only through developer tooling. Production dependencies were patched in `e02c5846`.

## Dependencies to fix or triage before the audit

From the package's scans (`vuln-scans/`). Production dependencies of the pnpm workspace (web,
extension, desktop, packages, services) have no critical or high advisory left after the
accepted ones. Three things fall outside that gate:

1. **Desktop ships Electron 33.4.11** — 38 advisories, 11 of them high, among them a
   context-isolation bypass (GHSA-h7rp-cf8h-j98x), popups and windows that drop sandbox
   restrictions (GHSA-hq2x-r82h-9wj4, GHSA-gr2m-v5gq-v685) and several use-after-frees.
   Electron is a devDependency, so the production audit never counts it, but it is the runtime
   inside every desktop build. Electron 33 is out of support (current: 44.9.1). Some are
   mitigated by the app's own hardening (F-1 denies `window.open` and blocks `<webview>`); the
   isolation bypass bears directly on H-1. Upgrade to a supported major, then re-test the
   keychain, Ledger and Mac App Store builds.
2. **Mobile still ships protobufjs 6.11.6 — critical, arbitrary code execution
   (GHSA-xq3m-2v4x-88gg)** through `@cosmjs/stargate` 0.32.4 → `@confio/ics23`, the item the
   2026-08-27 package called its top priority. Also critical: shell-quote 1.10.0 (through
   `react-native` → `react-devtools-core`), and 38 packages with high advisories (axios, ws,
   undici, fast-uri, tar, @xmldom/xmldom, nanoid, …). The workspace already forces patched
   versions of all of these in `package.json` → `pnpm.overrides`; `apps/mobile` has its own
   lockfile and no matching `overrides`. Mirror them in `apps/mobile/package.json`, regenerate
   `package-lock.json`, and re-test the Cosmos send path.
3. Development only, not shipped: vitest 2.1.9 / tinypool (three critical), adm-zip,
   extract-zip, tmp. Upgrade when convenient.

The `sbom` workflow's `sbom-spdx.json` is CycloneDX, not SPDX: cdxgen 11 has no SPDX writer
and the step's `|| true` hides it. The package ships CycloneDX only.

## Changed since the audit — not yet reviewed

117 commits on `main` since `6cc88ee4`. These touch keys, signing, permissions or funds and
should be in the next review's scope (the package lists every commit and file):

1. **Several wallets per client** — vault format and account handling on all four clients
   (`ad5cc08b` web, `7d36cf08` desktop, `6dea33d9` / `75149fe8` extension, `b2db3b60` /
   `295e19b2` mobile), including creating a wallet after a private-key import.
2. **Extension connections** — sites follow the active account, can ask to connect again and
   disconnect (`27f19881`, `3023f61f`); the permission model F-2 / F-3 hardened. Worth a
   look: switching accounts moves **every** connected site to the new account and sends it
   the address (`apps/extension/src/lib/dapp-connections.ts`, `followActiveAccount`), so a
   site connected under one account learns each account the user switches to, without being
   asked. That links the user's accounts across sites; per-site account permission is the
   usual alternative.
3. **Thanos MultiSig** on the Litho Vault SDK, gas-free approvals, on Lithosphere Mainnet
   (`678dc50d` … `d5f02b33`). It has its own package: `scripts/multisig-audit-package.sh`.
4. **MultX bridge** in every app (`457371a6`, `eb668893`, `f7ae2204`): pinned release
   manifest, lock/release tracking, receipt verification. Off by default.
5. **Quantts funding and withdrawals** — deposits in LAX / LITHO on chain 9005, private-key
   wallets, resumable withdrawals (`069ea93e`, `936c81cd`, `e7c59545`).
6. **LAX identity verification inside the desktop app**, with camera and location consent
   in the in-app browser (`b53019fd`); LAX on Ethereum, BNB Chain and Base (`a0d159d4`,
   `f6de73e0`).
7. **litho1 as the standard Lithosphere address format** on every client (`ef619d9d`,
   `109f4e19`) — address conversion is on the send path.
8. **Chain handling** — WalletConnect requests signed on the chain they name (`f1498ec9`),
   network-switch offers in the extension (`13a07459`), sends on the chain of the chosen
   balance (`30e112d5`, `f6c691cf`, `59754bbd`).
9. Mobile QR scanner reading uploaded images (`c89e9f7b`); full transaction history from
   explorers on every network (`0446c8ea`).

## Not covered by this package

- **What is deployed.** The live commit on thanos.fi can't be confirmed from here: run
  `git -C /var/www/thanos-wallet rev-parse HEAD` on the VPS. Store builds: extension 1.0.15
  (built by the Extension release run at this commit), desktop 0.3.9, mobile 2.0.13
  (iOS build 43, Android versionCode 47) — which of these are live in each store is for the
  owner to confirm.
- **Store binaries** are not part of the package (the script makes no store builds).
- **Postgres-backed API tests** run in CI's own job, not in the package; the web Playwright
  e2e suite is not run anywhere automatically.
