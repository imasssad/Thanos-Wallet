# Building Thanos Desktop on macOS

> **For Claude Code / agents running on the Mac:** this is the authoritative
> procedure for producing a macOS build of `apps/desktop`. Follow the numbered
> steps in order. Do **not** invent an Xcode project — there isn't one (see
> below). Do **not** submit to the App Store or publish a GitHub Release: per a
> standing client instruction, macOS/Windows stay unreleased until the other
> open issues are cleared. Local `.dmg` builds for testing are fine.

## What this is

`apps/desktop` is an **Electron** app (Electron 33, TypeScript main process +
Vite-built renderer). It is packaged with **`electron-builder`**, not Xcode.
There is no `.xcodeproj`. Xcode's *Command Line Tools* are still a prerequisite
— they provide `codesign`, `xcrun notarytool`, `git`, and the C toolchain that
`node-gyp` needs — but you never open the Xcode GUI.

Two macOS build flavors:

| Flavor | Target | Signing | Notes |
|---|---|---|---|
| **Direct download** | `.dmg` + `.zip` | Developer ID (or unsigned) + notarization | Keeps hardware-wallet + auto-update. This doc. |
| **Mac App Store** | `.pkg` (`mas` target) | Mac App Distribution + Mac Installer Distribution + provisioning profile | Sandboxed; HW-wallet + auto-update compiled out. See [`DESKTOP-MACOS-APP-STORE.md`](./DESKTOP-MACOS-APP-STORE.md). |

Config lives in `apps/desktop/electron-builder.yml`. Output goes to
`apps/desktop/release/` (NOT `dist/` — `dist/` is the pre-package bundle and is
itself packaged; see the comment in the yml). Artifact names follow
`${productName}-${version}-${arch}.${ext}`, e.g. `Thanos Wallet-0.3.3-arm64.dmg`.

Bundle id: `ai.thanos.wallet`. Apple team: `JEYAFQ92YG` (KaJ Labs LLC).

---

## Option A — build in CI, skip the Mac entirely

The repo has a working `Desktop macOS build` GitHub Action
(`.github/workflows/desktop-macos.yml`, runs on `macos-14`) with the
node-gyp / lockfile / output-path fixes already applied. It is the project's
Mac build machine — macOS Electron builds cannot be produced from the Windows
dev box.

1. GitHub → **Actions** → **"Desktop macOS build"** → **Run workflow** → `main`
   (or push a `desktop-v*` tag).
2. Download the `thanos-desktop-macos` artifact (`.dmg` + `.zip`, arm64 + x64).

Signing/notarization run only if the `CSC_LINK` / `APPLE_ID` /
`APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` repo secrets are set; otherwise
the artifact is unsigned (fine for internal testing).

Use this unless you specifically need to iterate on a Mac.

---

## Option B — build locally on the Mac

### 1. Prerequisites (one time per machine)

```bash
# Xcode Command Line Tools
xcode-select --install

# Node 20  (Homebrew shown; nvm is fine too)
brew install node@20 && brew link --overwrite node@20

# pnpm 9.12.0 — the exact version pnpm-lock.yaml was produced with
corepack enable
corepack prepare pnpm@9.12.0 --activate

# Python 3.11 — REQUIRED. node-gyp compiles keccak / blake-hash /
# tiny-secp256k1 / bigint-buffer from source, and Python 3.12+ removed the
# `distutils` stdlib module they import. Python 3.11 is the last with it.
brew install python@3.11
npm config set python "$(brew --prefix python@3.11)/bin/python3.11"

# Apple Silicon only, and only if you also want the Intel binary:
softwareupdate --install-rosetta --agree-to-license
```

### 2. Clone + install

```bash
git clone https://github.com/imasssad/Thanos-Wallet.git
cd Thanos-Wallet
pnpm install --frozen-lockfile
```

### 3. Build the bundle (main process + renderer)

```bash
pnpm --filter @thanos/desktop build        # or: cd apps/desktop && pnpm build  (what CI runs)
```

That's `tsc -p tsconfig.main.json && vite build` inside `apps/desktop` — the
transpiled main process + the Vite renderer bundle, both into `apps/desktop/dist/`.
This must succeed before packaging.

### 4a. Unsigned `.dmg` — fast, for local testing

```bash
cd apps/desktop
npx electron-builder --mac dmg --arm64 --publish never
# add --x64 to also build the Intel binary
```

Output: `apps/desktop/release/Thanos Wallet-<version>-arm64.dmg`.

Unsigned apps are Gatekeeper-blocked on first launch — **right-click → Open**,
or `xattr -dr com.apple.quarantine "/Applications/Thanos Wallet.app"`.

### 4b. Signed + notarized `.dmg` — for distribution outside the store

Requires a **"Developer ID Application"** certificate in the login keychain
(from developer.apple.com, team `JEYAFQ92YG`).

```bash
cd apps/desktop
export APPLE_ID="apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # appleid.apple.com → App-Specific Passwords
export APPLE_TEAM_ID="JEYAFQ92YG"

npx electron-builder --mac dmg zip --arm64 --x64 --publish never \
  --config.mac.notarize.teamId="$APPLE_TEAM_ID"
```

electron-builder auto-discovers the Developer ID cert from the keychain, signs
with hardened runtime + `build/entitlements.mac.plist`, then notarizes via
`notarytool` (a few minutes). `electron-builder.yml` sets `mac.notarize: false`
by default, so the `--config.mac.notarize.teamId=…` flag (or a matching env in
CI) is what turns it on.

### 4c. Mac App Store `.pkg`

See [`DESKTOP-MACOS-APP-STORE.md`](./DESKTOP-MACOS-APP-STORE.md) for the full
procedure and the entitlement/sandbox caveats. Short version, once the certs +
`apps/desktop/build/thanos-mas.provisionprofile` are in place:

```bash
cd apps/desktop
MAS_BUILD=1 pnpm --filter @thanos/desktop build   # dead-code-eliminates HW-wallet UI
npx electron-builder --mac mas --publish never
# → apps/desktop/release/Thanos Wallet-<version>.pkg
# upload with the Transporter app, or:
xcrun altool --upload-app -f "release/Thanos Wallet-<version>.pkg" -t macos \
  -u "$APPLE_ID" -p "$APPLE_APP_SPECIFIC_PASSWORD"
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ModuleNotFoundError: No module named 'distutils'`, or `node-gyp` fails on `keccak` / `tiny-secp256k1` / `blake-hash` / `bigint-buffer` | Python 3.11 isn't being used. `npm config set python "$(brew --prefix python@3.11)/bin/python3.11"`, then `rm -rf node_modules && pnpm install --frozen-lockfile` and rebuild. |
| `electron-builder` writes to `release/@thanos/…` and fails | Stale `electron-builder` — the `artifactName` in `electron-builder.yml` fixes this; make sure you're on current `main`. |
| Installers keep growing each build / archive too large | Don't set `directories.output` back to `dist/` — it must stay `release/` (see the yml comment). |
| `pnpm install` resolves different versions than CI | Always use `--frozen-lockfile`. |
| Notarization hangs or `notarytool` auth fails | Check `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`; the password must be an app-specific password, not the Apple ID password. |
| App opens but "damaged / can't be opened" | Unsigned build — right-click → Open, or clear the quarantine xattr (see 4a). |

## Reference

- `apps/desktop/electron-builder.yml` — all targets, signing, entitlements, GitHub auto-update channel (`imasssad/Thanos-Wallet` releases)
- `apps/desktop/build/entitlements.mac.plist` — direct-download entitlements
- `apps/desktop/build/entitlements.mas.plist` + `entitlements.mas.inherit.plist` — sandboxed MAS entitlements
- `.github/workflows/desktop-macos.yml` — the CI equivalent of Option B (`macos-14`, Python 3.11 pin, arm64 + x64)
- `.github/workflows/desktop-macos-appstore.yml` — CI for the `.pkg`
- `docs/DESKTOP-MACOS-APP-STORE.md` — Mac App Store specifics + review expectations
- `docs/SIGNING-ISOLATION.md` — how signing secrets are kept out of the build graph
