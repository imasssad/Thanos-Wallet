#!/usr/bin/env bash
# Builds the Thanos MultiSig audit package: the in-scope sources of one commit (the shared
# multisig core and screens, the four clients' signing bridges and the signers they call, the
# mobile screens), the vendored Litho Vault SDK with its checksum, the test results and the
# docs, with a checksum list, in one zip.
#
#   scripts/multisig-audit-package.sh          # from the repository root, on a clean checkout
#
# RUN_E2E=1 also runs the web end-to-end test (builds the web app; needs Playwright's Chromium).
# ALLOW_DIRTY=1 for local trial runs only (the results would not match the archived commit).
#
# Output: audit-package/thanos-multisig-audit-<tag or commit>/ and the .zip next to it.
# The contracts and the SDK's source are covered by the Litho Vault audit package
# (litho-vault: scripts/audit-package.sh).
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
name="thanos-multisig-audit-$version"
out="$root/audit-package/$name"
sdk=vendor/litho-vault-sdk-1.0.0.tgz

# In scope, then context (the existing signers the bridges call).
scope=(
  packages/multisig
  apps/web/lib/multisig.ts apps/web/components/MultiSigView.tsx apps/web/app/app/multisig apps/web/lib/csp.js apps/web/lib/csp.test.ts
  apps/web/e2e/multisig.spec.ts apps/web/e2e/multisig-chain.ts
  apps/extension/src/lib/multisig.ts apps/extension/src/entrypoints/popup/MultiSigScreen.tsx
  apps/desktop/src/renderer/multisig.tsx
  apps/mobile/components/MultiSig.tsx apps/mobile/lib/multisig
  scripts/sync-multisig.mjs docs/MULTISIG.md
)
context=(
  apps/web/lib/signer-client.ts apps/web/workers/signer-worker.ts apps/web/lib/signer.ts
  apps/extension/src/entrypoints/popup/offscreen-sign.ts apps/extension/src/entrypoints/offscreen/main.ts
  apps/desktop/src/main/signer.ts apps/desktop/src/main/preload.ts
  apps/mobile/lib/signer.ts
)

rm -rf "$out" "$out.zip"
mkdir -p "$out/source" "$out/vendor" "$out/results" "$out/docs"

step() { printf '\n== %s\n' "$1"; }
record() {
  local file=$1; shift
  if ! "$@" 2>&1 | tee "$file"; then
    echo "FAILED: $* (output in ${file#"$root"/})" >&2
    exit 1
  fi
}

step "Sources at $commit"
git archive --format=tar.gz --prefix="thanos-multisig-$version/" -o "$out/source/in-scope.tar.gz" HEAD -- "${scope[@]}"
git archive --format=tar.gz --prefix="thanos-multisig-$version/" -o "$out/source/context-signers.tar.gz" HEAD -- "${context[@]}"
git diff --stat "$(git merge-base HEAD origin/main 2>/dev/null || echo HEAD)" HEAD > "$out/source/changed-files.txt" || true

step "Vendored Litho Vault SDK"
cp "$sdk" "$out/vendor/"
sdk_sha=$(sha256sum "$sdk" | cut -d' ' -f1)
tar xzf "$sdk" -O package/package.json > "$out/vendor/sdk-package.json"

step "Tests"
record "$out/results/multisig-tests.txt" pnpm --filter @thanos/multisig test
record "$out/results/mobile-copy-check.txt" node scripts/sync-multisig.mjs --check
record "$out/results/web-unit-tests.txt" pnpm --filter @thanos/web test
record "$out/results/typecheck.txt" pnpm typecheck
if [ "${RUN_E2E:-}" = "1" ]; then
  record "$out/results/web-e2e.txt" pnpm --filter @thanos/web exec playwright test e2e/multisig.spec.ts
fi

step "Documents"
cp docs/MULTISIG.md "$out/docs/"

passing() { grep -Eo 'Tests +[0-9]+ passed[^|]*' "$1" | sed -E 's/\x1b\[[0-9;]*m//g' | tail -1 || echo "?"; }
cat > "$out/README.md" <<EOF
# Thanos MultiSig audit package — $version

| | |
|---|---|
| Repository | https://github.com/imasssad/Thanos-Wallet |
| Commit | \`$commit\`${tag:+ (tag \`$tag\`)} |
| Built | $(date -u +%Y-%m-%dT%H:%M:%SZ) |
| Toolchain | Node.js $(node --version), pnpm $(pnpm --version) |
| Litho Vault SDK | \`$sdk\`, SHA-256 \`$sdk_sha\` (built from litho-vault by \`npm run pack -w @litho-vault/sdk\`; its source and the contracts are in the Litho Vault audit package) |

Start with \`docs/MULTISIG.md\`: what Thanos MultiSig does, how each client signs, and the
properties to check ("For the audit").

## Results

| Check | Result | File |
|---|---|---|
| Multisig core against the real Litho Vault contracts (local chain) | $(passing "$out/results/multisig-tests.txt") | \`results/multisig-tests.txt\` |
| Mobile copy of the core matches the source | $(grep -q 'out of date' "$out/results/mobile-copy-check.txt" && echo "differs" || echo "matches") | \`results/mobile-copy-check.txt\` |
| Web unit tests (vault, CSP, …) | $(passing "$out/results/web-unit-tests.txt") | \`results/web-unit-tests.txt\` |
| Typecheck, every workspace | $(grep -Eo 'Tasks: +[0-9]+ successful, [0-9]+ total' "$out/results/typecheck.txt" | tail -1) | \`results/typecheck.txt\` |
$( [ "${RUN_E2E:-}" = "1" ] && echo "| Web end-to-end (create, propose, approve, execute) | $(grep -Eo '[0-9]+ passed' "$out/results/web-e2e.txt" | tail -1) | \`results/web-e2e.txt\` |" || echo "| Web end-to-end (create, propose, approve, execute) | not run in this package (RUN_E2E=1); see docs/MULTISIG.md, Tests | — |")

## Contents

- \`source/in-scope.tar.gz\`: the files in scope at this commit; \`source/context-signers.tar.gz\`:
  the existing signers the bridges call (unchanged by Thanos MultiSig except an optional gasLimit
  in the extension's TxParams); \`source/changed-files.txt\`.
- \`vendor/\`: the vendored SDK exactly as the apps install it.
- \`results/\`: full output of every check. \`docs/\`, \`SHA256SUMS\`.
EOF

(cd "$out" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
(cd "$root/audit-package" && zip -qr "$name.zip" "$name")

step "Done"
echo "Package: ${out#"$root"/}.zip ($(du -h "$out.zip" | cut -f1))"
echo "SHA-256: $(sha256sum "$out.zip" | cut -d' ' -f1)"
