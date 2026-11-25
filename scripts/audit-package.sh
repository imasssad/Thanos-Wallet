#!/usr/bin/env bash
# Builds the Thanos Wallet audit package for one commit: the full source, the SBOMs, the
# dependency vulnerability scans, the output of every check CI runs plus the builds, the
# security documents and the previous audit, with a checksum list, in one zip.
#
#   scripts/audit-package.sh          # from the repository root, on a clean checkout
#
# MOBILE=1       also installs apps/mobile (npm ci, outside the pnpm workspace) and typechecks it.
# DESKTOP=1      also packages the desktop app for Linux (electron-builder --dir), which runs the
#                afterPack check on the packaged ethers. DESKTOP_ARGS adds electron-builder options
#                (e.g. -c.electronDist=<dir> where Electron can't be downloaded).
# SINCE=<rev>    base for "changes since the last audit"; default 6cc88ee4, the remediation
#                status of the 2026-09-27 hardening audit (docs/audit/2026-09-27).
# NOTES=<file>   a Markdown note to include as STATUS.md (e.g. the finding status at this commit).
# ALLOW_DIRTY=1  local trial runs only (the results would not match the archived commit).
#
# Output: audit-package/thanos-wallet-audit-<tag or commit>/ and the .zip next to it.
# A failing check does not stop the package: it is recorded as failed in the README, with its
# full output in results/. Thanos MultiSig has its own package (scripts/multisig-audit-package.sh).
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"

if [ -n "$(git status --porcelain --untracked-files=no)" ] && [ "${ALLOW_DIRTY:-}" != "1" ]; then
  echo "The working tree has uncommitted changes; the package must match one commit. Commit or stash them first." >&2
  exit 1
fi

commit=$(git rev-parse HEAD)
tag=$(git describe --tags --exact-match HEAD 2>/dev/null || true)
version=${tag:-$(git rev-parse --short=12 HEAD)}
since=${SINCE:-6cc88ee4}
name="thanos-wallet-audit-$version"
out="$root/audit-package/$name"
cdxgen="@cyclonedx/cdxgen@11"

rm -rf "$out" "$out.zip"
mkdir -p "$out/source" "$out/sbom" "$out/vuln-scans" "$out/results" "$out/docs"

step() { printf '\n== %s\n' "$1"; }
rows=()
# check <label> <file> <command...>: runs it, keeps the full output, records pass/fail.
check() {
  local label=$1 file=$2; shift 2
  step "$label"
  if "$@" > "$out/results/$file" 2>&1; then
    rows+=("| $label | pass | \`results/$file\` |")
  else
    rows+=("| $label | **FAILED** (exit $?) | \`results/$file\` |")
    echo "FAILED: $label (output in results/$file)" >&2
  fi
}
strip() { sed -E 's/\x1b\[[0-9;]*m//g' "$@"; }
summary() { strip "$1" | grep -Eo "$2" | tail -1 | tr -s ' ' || true; }

step "Sources at $commit"
git archive --format=tar.gz --prefix="thanos-wallet-$version/" -o "$out/source/thanos-wallet-$version.tar.gz" HEAD
if git cat-file -e "$since^{commit}" 2>/dev/null; then
  git log --format='%h %ad %an  %s' --date=short "$since..HEAD" > "$out/source/commits-since-last-audit.txt"
  git diff --stat=200 "$since" HEAD > "$out/source/diffstat-since-last-audit.txt"
  areas=(apps/web apps/extension apps/desktop apps/mobile packages services contracts .github scripts docs)
  area_rows=$(for a in "${areas[@]}"; do
    s=$(git diff --shortstat "$since" HEAD -- "$a" | sed -E 's/^ +//')
    [ -n "$s" ] && echo "| \`$a\` | $s |"
  done)
else
  echo "SINCE=$since is not in this clone's history (shallow clone?); skipping the change summary." >&2
  area_rows="| — | \`$since\` not in this clone's history |"
fi

check "Install (pnpm install --frozen-lockfile)" install.txt pnpm install --frozen-lockfile
check "Typecheck, every workspace" typecheck.txt pnpm typecheck
check "Lint" lint.txt pnpm lint
check "sdk-core unit tests" test-sdk-core.txt pnpm --filter @thanos/sdk-core test
check "Web unit tests" test-web.txt pnpm --filter @thanos/web test
check "API tests (Postgres-backed ones skip without a database)" test-api.txt pnpm --filter @thanos/api test
check "MultX adapter tests" test-multx-adapter.txt pnpm --filter multx-adapter test
check "MultiSig core against Litho Vault contracts (local Hardhat chain)" test-multisig.txt pnpm --filter @thanos/multisig test
check "Extension tests (vault, THN-02, O-01 sender gates)" test-extension.txt pnpm --filter @thanos/extension test
check "Desktop tests (ipc-guard.ts trust boundary, O-01/M20-M21)" test-desktop.txt pnpm --filter @thanos/desktop test
check "Mobile copies of shared code match their sources" sync-checks.txt \
  bash -c 'node scripts/sync-multisig.mjs --check && node scripts/sync-multx-thanos.mjs --check && echo "multisig and multx-thanos: mobile copies match"'
check "Web production build" build-web.txt pnpm --filter @thanos/web build
check "Extension build" build-extension.txt pnpm --filter @thanos/extension build
check "Extension bundle-size budget" bundle-size.txt bash ops/bundle-size-check.sh
check "Desktop build (main process + renderer)" build-desktop.txt pnpm --filter @thanos/desktop build
if [ "${DESKTOP:-}" = "1" ]; then
  check "Desktop packaged app (electron-builder --dir, afterPack ethers check)" package-desktop.txt \
    bash -c 'cd apps/desktop && npx electron-builder --linux dir --publish never -c.directories.output="$0" ${DESKTOP_ARGS:-}' "$out/.desktop-build"
  rm -rf "$out/.desktop-build"
fi
if [ "${MOBILE:-}" = "1" ]; then
  check "Mobile install (npm ci)" mobile-install.txt bash -c 'cd apps/mobile && npm ci --no-audit --no-fund'
  check "Mobile typecheck" mobile-typecheck.txt bash -c 'cd apps/mobile && npm run typecheck'
fi

step "SBOMs ($cdxgen)"
export FETCH_LICENSE=${FETCH_LICENSE:-true}   # as the sbom workflow does
check "SBOM, workspace (CycloneDX)" sbom-cyclonedx.txt npx -y "$cdxgen" -t js -r . -o "$out/sbom/sbom-cyclonedx.json"
check "SBOM, mobile (CycloneDX)" sbom-mobile.txt bash -c 'cd apps/mobile && npx -y "$0" -t js -r . -o "$1"' "$cdxgen" "$out/sbom/sbom-mobile.json"
components() { node -e 'const j=require(process.argv[1]); console.log((j.components||j.packages||[]).length)' "$1" 2>/dev/null || echo "?"; }

step "Dependency vulnerability scans"
# The blocking CI gate (high and above, production dependencies); the full JSON for the details.
# pnpm's JSON lists advisories after pnpm.auditConfig.ignoreGhsas but its metadata counts still
# include the ignored ones, so counts come from the advisory list. npm's counts are packages.
check "pnpm audit --prod --audit-level=high (CI gate)" audit-gate.txt pnpm audit --prod --audit-level=high
pnpm audit --prod --json > "$out/vuln-scans/pnpm-audit-prod.json" 2>/dev/null || true
pnpm audit --json > "$out/vuln-scans/pnpm-audit-all.json" 2>/dev/null || true
(cd apps/mobile && npm audit --package-lock-only --omit=dev --json) > "$out/vuln-scans/npm-audit-mobile-prod.json" 2>/dev/null || true
(cd apps/mobile && npm audit --package-lock-only --json) > "$out/vuln-scans/npm-audit-mobile-all.json" 2>/dev/null || true
cp "$out/results/audit-gate.txt" "$out/vuln-scans/"
counts() {  # "critical C, high H, moderate M, low L" from a pnpm / npm audit JSON
  node -e '
    const j = require(process.argv[1]); const n = { critical: 0, high: 0, moderate: 0, low: 0 };
    if (j.advisories) for (const a of Object.values(j.advisories)) n[a.severity] = (n[a.severity] ?? 0) + 1;
    else Object.assign(n, (j.metadata || {}).vulnerabilities || {});
    const unit = j.advisories ? "advisories" : "affected packages";
    console.log(["critical","high","moderate","low"].map(k => `${k} ${n[k] ?? 0}`).join(", ") + ` (${unit})`);
  ' "$1" 2>/dev/null || echo "not available"
}
# Electron is a devDependency, so the production scan never counts the runtime the desktop app
# ships; report its advisories on their own.
electron_line=$(node -e '
  const j = require(process.argv[1]); const v = require(process.argv[2]).devDependencies?.electron;
  const hits = Object.values(j.advisories || {}).filter(a => a.module_name === "electron");
  const sev = {}; for (const a of hits) sev[a.severity] = (sev[a.severity] ?? 0) + 1;
  const ver = [...new Set(hits.flatMap(a => (a.findings || []).map(f => f.version)))].join(", ");
  console.log(hits.length ? `electron ${ver || v}: ${hits.length} advisories (${Object.entries(sev).map(([k, c]) => c + " " + k).join(", ")})` : `electron ${v}: no advisories`);
' "$out/vuln-scans/pnpm-audit-all.json" "$root/apps/desktop/package.json" 2>/dev/null || echo "electron: not available")
ignored=$(node -p "((require('./package.json').pnpm||{}).auditConfig||{}).ignoreGhsas?.join(', ') || 'none'")

step "Documents"
docs=(SECURITY.md docs/SECURITY-AUDIT-SCOPE.md docs/SIGNING-ISOLATION.md docs/architecture.md
  docs/production-readiness-audit.md docs/audit/2026-09-27/HARDENING-AUDIT.md
  docs/MULTISIG.md docs/integrations/MULTX-THANOS.md)
for d in "${docs[@]}"; do [ -f "$d" ] && cp "$d" "$out/docs/"; done
[ -n "${NOTES:-}" ] && cp "$NOTES" "$out/STATUS.md"

ver() { node -p "require('./$1').$2" 2>/dev/null || echo "?"; }
ci_rows=""
if command -v gh >/dev/null 2>&1; then
  ci_rows=$(gh api "repos/imasssad/Thanos-Wallet/actions/runs?head_sha=$commit&per_page=50" \
    --jq '.workflow_runs[] | select(.event != "dynamic") | "| \(.name) | \(.conclusion // .status) | [\(.id)](\(.html_url)) |"' 2>/dev/null || true)
fi

cat > "$out/README.md" <<EOF
# Thanos Wallet audit package — $version

| | |
|---|---|
| Repository | https://github.com/imasssad/Thanos-Wallet |
| Commit | \`$commit\`${tag:+ (tag \`$tag\`)} |
| Built | $(date -u +%Y-%m-%dT%H:%M:%SZ) on $(uname -sm) |
| Toolchain | Node.js $(node --version), pnpm $(pnpm --version), npm $(npm --version) |
| Versions at this commit | web $(ver apps/web/package.json version), extension $(ver apps/extension/package.json version), desktop $(ver apps/desktop/package.json version), mobile $(ver apps/mobile/app.json expo.version) (iOS build $(ver apps/mobile/app.json expo.ios.buildNumber), Android versionCode $(ver apps/mobile/app.json expo.android.versionCode)), API $(ver services/api/package.json version) |

Start with \`docs/SECURITY-AUDIT-SCOPE.md\` (surfaces and threat model), \`docs/SIGNING-ISOLATION.md\`
(where keys live on each client) and \`docs/HARDENING-AUDIT.md\` (the last audit, with the
remediation status of every finding).${NOTES:+ \`STATUS.md\` gives the finding status at this commit.}

## Checks run for this package

| Check | Result | Output |
|---|---|---|
$(printf '%s\n' "${rows[@]}")

Test counts: sdk-core $(summary "$out/results/test-sdk-core.txt" 'Tests +[0-9]+ passed[^|]*'), web $(summary "$out/results/test-web.txt" 'Tests +[0-9]+ passed[^|]*'), API $(summary "$out/results/test-api.txt" 'Tests +[0-9]+ passed[^|]*'), MultX adapter $(summary "$out/results/test-multx-adapter.txt" 'Tests +[0-9]+ passed[^|]*'), MultiSig $(summary "$out/results/test-multisig.txt" 'Tests +[0-9]+ passed[^|]*').
Not run here: the API tests that need Postgres (CI runs them in its own job), the web Playwright
end-to-end suite (\`apps/web/e2e\`, not run in CI)$( [ "${MOBILE:-}" = "1" ] || echo ", the mobile install and typecheck (MOBILE=1)")$( [ "${DESKTOP:-}" = "1" ] || echo ", the packaged desktop app (DESKTOP=1)"). No store builds are made by this script.

## CI at this commit

$( [ -n "$ci_rows" ] && printf '| Workflow | Result | Run |\n|---|---|---|\n%s\n' "$ci_rows" || echo "Not looked up (no gh)." )

## Dependencies

- Lockfiles (in the source archive): \`pnpm-lock.yaml\` (web, desktop, extension, packages, services)
  and \`apps/mobile/package-lock.json\` (mobile is outside the pnpm workspace).
- SBOMs (\`sbom/\`, CycloneDX 1.6, $cdxgen): workspace $(components "$out/sbom/sbom-cyclonedx.json") components,
  mobile $(components "$out/sbom/sbom-mobile.json") components. (cdxgen 11 writes no SPDX.)
- Vulnerability scans (\`vuln-scans/\`), production dependencies: workspace $(counts "$out/vuln-scans/pnpm-audit-prod.json");
  mobile $(counts "$out/vuln-scans/npm-audit-mobile-prod.json"). Including development
  dependencies: workspace $(counts "$out/vuln-scans/pnpm-audit-all.json"); mobile $(counts "$out/vuln-scans/npm-audit-mobile-all.json").
- Desktop runtime (shipped inside every desktop build, not in the production scan): $electron_line.
- Advisories accepted in \`package.json\` (\`pnpm.auditConfig.ignoreGhsas\`), with the reachability
  analysis in \`docs/SECURITY.md\`: $ignored.
- Vendored packages (in the source archive): $(for f in vendor/*.tgz; do printf '`%s` SHA-256 `%s`\n' "$f" "$(sha256sum "$f" | cut -d' ' -f1)"; done | paste -sd';' | sed 's/;/; /g')

## Changes since the last audit

Since \`$since\` (the remediation status of the 2026-09-27 audit): $(wc -l < "$out/source/commits-since-last-audit.txt" 2>/dev/null || echo "?") commits.
\`source/commits-since-last-audit.txt\` lists them, \`source/diffstat-since-last-audit.txt\` has every file.

| Area | Change |
|---|---|
$area_rows

## Contents

- \`source/\`: the full tree at this commit (\`git archive\`), and the change lists above.
- \`results/\`: full output of every check. \`sbom/\`, \`vuln-scans/\`, \`docs/\`$( [ -n "${NOTES:-}" ] && echo ", \`STATUS.md\`"), \`SHA256SUMS\`.

Rebuild: check out \`$commit\` on a clean machine and run \`scripts/audit-package.sh\` (with the
same MOBILE / DESKTOP settings); the checks and SBOMs should match, the vulnerability counts can
grow as new advisories are published.
EOF

(cd "$out" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
(cd "$root/audit-package" && zip -qr "$name.zip" "$name")

step "Done"
printf '%s\n' "${rows[@]}"
echo "Package: ${out#"$root"/}.zip ($(du -h "$out.zip" | cut -f1))"
echo "SHA-256: $(sha256sum "$out.zip" | cut -d' ' -f1)"
