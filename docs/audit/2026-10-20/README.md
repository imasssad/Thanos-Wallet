# Thanos Wallet audit package — f8e5f2f0db7b

| | |
|---|---|
| Repository | https://github.com/imasssad/Thanos-Wallet |
| Commit | `f8e5f2f0db7bcb8f2796b7ee530773fd5216a257` |
| Built | 2026-10-20T14:14:16Z on Linux x86_64 |
| Toolchain | Node.js v22.22.2, pnpm 9.12.0, npm 10.9.7 |
| Versions at this commit | web 0.2.1, extension 1.0.15, desktop 0.3.9, mobile 2.0.13 (iOS build 43, Android versionCode 47), API 1.0.0 |

Start with `docs/SECURITY-AUDIT-SCOPE.md` (surfaces and threat model), `docs/SIGNING-ISOLATION.md`
(where keys live on each client) and `docs/HARDENING-AUDIT.md` (the last audit, with the
remediation status of every finding). `STATUS.md` gives the finding status at this commit.

## Checks run for this package

| Check | Result | Output |
|---|---|---|
| Install (pnpm install --frozen-lockfile) | pass | `results/install.txt` |
| Typecheck, every workspace | pass | `results/typecheck.txt` |
| Lint | pass | `results/lint.txt` |
| sdk-core unit tests | pass | `results/test-sdk-core.txt` |
| Web unit tests | pass | `results/test-web.txt` |
| API tests (Postgres-backed ones skip without a database) | pass | `results/test-api.txt` |
| MultX adapter tests | pass | `results/test-multx-adapter.txt` |
| MultiSig core against Litho Vault contracts (local Hardhat chain) | pass | `results/test-multisig.txt` |
| Mobile copies of shared code match their sources | pass | `results/sync-checks.txt` |
| Web production build | pass | `results/build-web.txt` |
| Extension build | pass | `results/build-extension.txt` |
| Extension bundle-size budget | pass | `results/bundle-size.txt` |
| Desktop build (main process + renderer) | pass | `results/build-desktop.txt` |
| Desktop packaged app (electron-builder --dir, afterPack ethers check) | pass | `results/package-desktop.txt` |
| Mobile install (npm ci) | pass | `results/mobile-install.txt` |
| Mobile typecheck | pass | `results/mobile-typecheck.txt` |
| SBOM, workspace (CycloneDX) | pass | `results/sbom-cyclonedx.txt` |
| SBOM, mobile (CycloneDX) | pass | `results/sbom-mobile.txt` |
| pnpm audit --prod --audit-level=high (CI gate) | pass | `results/audit-gate.txt` |

Test counts: sdk-core Tests 364 passed (364), web Tests 59 passed (59), API Tests 90 passed , MultX adapter Tests 51 passed (51), MultiSig Tests 7 passed (7).
Not run here: the API tests that need Postgres (CI runs them in its own job), the web Playwright
end-to-end suite (`apps/web/e2e`, not run in CI). No store builds are made by this script.

## CI at this commit

| Workflow | Result | Run |
|---|---|---|
| sbom | success | [39149854620](https://github.com/imasssad/Thanos-Wallet/actions/runs/39149854620) |
| Extension release | success | [39149854913](https://github.com/imasssad/Thanos-Wallet/actions/runs/39149854913) |
| ci | success | [39149854650](https://github.com/imasssad/Thanos-Wallet/actions/runs/39149854650) |

## Dependencies

- Lockfiles (in the source archive): `pnpm-lock.yaml` (web, desktop, extension, packages, services)
  and `apps/mobile/package-lock.json` (mobile is outside the pnpm workspace).
- SBOMs (`sbom/`, CycloneDX 1.6, @cyclonedx/cdxgen@11): workspace 2773 components,
  mobile 948 components. (cdxgen 11 writes no SPDX.)
- Vulnerability scans (`vuln-scans/`), production dependencies: workspace critical 0, high 0, moderate 24, low 3 (advisories);
  mobile critical 2, high 38, moderate 18, low 16 (affected packages). Including development
  dependencies: workspace critical 3, high 23, moderate 56, low 14 (advisories); mobile critical 2, high 38, moderate 18, low 16 (affected packages).
- Desktop runtime (shipped inside every desktop build, not in the production scan): electron 33.4.11: 38 advisories (21 moderate, 11 high, 6 low).
- Advisories accepted in `package.json` (`pnpm.auditConfig.ignoreGhsas`), with the reachability
  analysis in `docs/SECURITY.md`: GHSA-3gc7-fjrx-p6mg, GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq, GHSA-86w9-cpqp-85rv, GHSA-vfj7-8cjw-p6xm.
- Vendored packages (in the source archive): `vendor/litho-multx-sdk-0.2.0.tgz` SHA-256 `b93d65841342f706324e3ad0781a8868a16ae2b5f42ba97d88135e533bf70894`; `vendor/litho-vault-sdk-1.0.0.tgz` SHA-256 `e735e6336e96a4bc688c2fdfb6c8d8b659f8f25ccc8f515fc46bbaab809506d9`

## Changes since the last audit

Since `6cc88ee4` (the remediation status of the 2026-09-27 audit): 117 commits.
`source/commits-since-last-audit.txt` lists them, `source/diffstat-since-last-audit.txt` has every file.

| Area | Change |
|---|---|
| `apps/web` | 71 files changed, 5168 insertions(+), 2714 deletions(-) |
| `apps/extension` | 35 files changed, 3447 insertions(+), 1263 deletions(-) |
| `apps/desktop` | 43 files changed, 3809 insertions(+), 1492 deletions(-) |
| `apps/mobile` | 59 files changed, 8717 insertions(+), 2191 deletions(-) |
| `packages` | 66 files changed, 9865 insertions(+), 106 deletions(-) |
| `services` | 3 files changed, 442 insertions(+), 39 deletions(-) |
| `.github` | 6 files changed, 87 insertions(+), 18 deletions(-) |
| `scripts` | 3 files changed, 257 insertions(+) |
| `docs` | 5 files changed, 288 insertions(+), 29 deletions(-) |

## Contents

- `source/`: the full tree at this commit (`git archive`), and the change lists above.
- `results/`: full output of every check. `sbom/`, `vuln-scans/`, `docs/`, `STATUS.md`, `SHA256SUMS`.

Rebuild: check out `f8e5f2f0db7bcb8f2796b7ee530773fd5216a257` on a clean machine and run `scripts/audit-package.sh` (with the
same MOBILE / DESKTOP settings); the checks and SBOMs should match, the vulnerability counts can
grow as new advisories are published.

---

Package file: `thanos-wallet-audit-f8e5f2f0db7b.zip` (46 MB, 46 files), SHA-256
`872d27c3d194dbe73e5250ea9606e6f759b7b4662066113e70b7578c089fdef3`. Built with
`MOBILE=1 DESKTOP=1 NOTES=docs/audit/2026-10-20/STATUS.md scripts/audit-package.sh` on a clean
checkout of `f8e5f2f0` (Electron supplied locally with `DESKTOP_ARGS=-c.electronDist=…`).
The zip isn't committed; this README is its record.
