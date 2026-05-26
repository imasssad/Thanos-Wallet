#!/usr/bin/env bash
#
# One-shot age + SOPS bootstrap. Run this once on each machine that needs
# to decrypt ops/secrets/*.enc.env — typically:
#   - Your local laptop (for editing secrets)
#   - The production VPS (for decrypting at deploy time)
#
# What it does:
#   1. Installs `age` and `sops` if missing (apt / brew / chocolatey).
#   2. Generates an age keypair at ~/.config/sops/age/keys.txt if absent.
#   3. Prints the PUBLIC key and the exact `.sops.yaml` block to update.
#   4. Tells you what to do next (commit the public key, rotate recipients).
#
# What it DOESN'T do:
#   - Touch the private key after writing it. It stays local to the machine.
#   - Modify .sops.yaml in this repo — you do that manually after pasting
#     the public key from this script's output. (Auto-editing would risk
#     wiping co-recipients you don't know about.)
#
# Usage:
#   bash ops/secrets/bootstrap-age-keys.sh
#   bash ops/secrets/bootstrap-age-keys.sh --label vps-prod     # custom label in output
#
# Re-running is safe — if a key already exists at the standard path, it
# prints the existing public key without overwriting anything.

set -euo pipefail

LABEL="${LABEL:-$(hostname -s 2>/dev/null || echo local)}"
while [ $# -gt 0 ]; do
  case "$1" in
    --label) LABEL="$2"; shift 2 ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

KEY_DIR="${HOME}/.config/sops/age"
KEY_FILE="${KEY_DIR}/keys.txt"

c_green=$'\033[1;32m'
c_yellow=$'\033[1;33m'
c_red=$'\033[1;31m'
c_bold=$'\033[1m'
c_reset=$'\033[0m'

say() { printf "%s\n" "$*"; }
ok()   { printf "${c_green}✓${c_reset} %s\n" "$*"; }
warn() { printf "${c_yellow}⚠${c_reset} %s\n" "$*"; }
fail() { printf "${c_red}✗${c_reset} %s\n" "$*" >&2; exit 1; }

# ─── 1. Install age + sops if missing ─────────────────────────────────

# Install sops by direct binary download — Ubuntu 24.04+ dropped the apt
# package, and several other distros never carried it. We pin a known-good
# release; bump SOPS_VERSION when there's a security fix worth chasing.
install_sops_binary() {
  local sops_version="${SOPS_VERSION:-v3.9.1}"
  local os arch dest url
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) arch=amd64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) fail "unsupported architecture for sops binary install: $arch" ;;
  esac
  url="https://github.com/getsops/sops/releases/download/${sops_version}/sops-${sops_version}.${os}.${arch}"
  dest="/usr/local/bin/sops"
  warn "downloading sops ${sops_version} from GitHub release → ${dest}"
  if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
    sudo curl -fsSL -o "$dest" "$url"
    sudo chmod +x "$dest"
  else
    curl -fsSL -o "$dest" "$url"
    chmod +x "$dest"
  fi
}

install_tool() {
  local tool="$1"
  if command -v "$tool" >/dev/null 2>&1; then
    ok "$tool already installed: $(command -v "$tool")"
    return
  fi
  warn "$tool not found — installing"
  # Try the system package manager first. If that errors out (e.g. sops
  # was dropped from Ubuntu 24.04's repos), fall back to GitHub-release
  # binary install for sops; fail for age (age is in every modern repo).
  local pm_ok=0
  if   command -v apt-get  >/dev/null 2>&1; then
    (sudo apt-get update -qq && sudo apt-get install -y "$tool" 2>/dev/null) && pm_ok=1 || pm_ok=0
  elif command -v brew     >/dev/null 2>&1; then
    brew install "$tool" && pm_ok=1 || pm_ok=0
  elif command -v dnf      >/dev/null 2>&1; then
    sudo dnf install -y "$tool" && pm_ok=1 || pm_ok=0
  elif command -v pacman   >/dev/null 2>&1; then
    sudo pacman -S --noconfirm "$tool" && pm_ok=1 || pm_ok=0
  fi
  if [ "$pm_ok" -eq 0 ] || ! command -v "$tool" >/dev/null 2>&1; then
    if [ "$tool" = "sops" ]; then
      install_sops_binary
    else
      fail "$tool not available via the package manager — install manually from https://github.com/FiloSottile/age"
    fi
  fi
  command -v "$tool" >/dev/null 2>&1 || fail "$tool install reported success but the binary still isn't on PATH"
  ok "$tool installed: $(command -v "$tool")"
}

install_tool age
install_tool sops

# ─── 2. Generate or load the keypair ──────────────────────────────────

if [ -f "$KEY_FILE" ]; then
  ok "found existing key at $KEY_FILE — will not overwrite"
else
  warn "no key at $KEY_FILE — generating a fresh keypair"
  mkdir -p "$KEY_DIR"
  chmod 700 "$KEY_DIR"
  age-keygen -o "$KEY_FILE" 2>/dev/null
  chmod 600 "$KEY_FILE"
  ok "wrote new key to $KEY_FILE (mode 600)"
fi

# Extract the public key line from the file.
PUB_KEY="$(grep -m1 '^# public key:' "$KEY_FILE" | awk '{print $4}')"
if [ -z "$PUB_KEY" ]; then
  # Older age-keygen versions write it as 'Public key:' (capital P, no #).
  PUB_KEY="$(grep -m1 -i 'public key:' "$KEY_FILE" | awk '{print $NF}')"
fi
[ -n "$PUB_KEY" ] || fail "couldn't extract public key from $KEY_FILE — file may be corrupt"

# ─── 3. Print the result + next steps ─────────────────────────────────

cat <<EOF

${c_bold}─── Your age public key (${LABEL}) ───${c_reset}

  ${c_green}${PUB_KEY}${c_reset}

${c_bold}Next steps${c_reset}

  ${c_bold}1.${c_reset} Add this public key to .sops.yaml. Open the file and replace the
     ${c_yellow}age1placeholder...${c_reset} entries with the key above. Comma-separate
     additional recipients on the same line.

       creation_rules:
         - path_regex: ops/secrets/prod\\.enc\\.env\$
           age: >-
             ${PUB_KEY}

         - path_regex: ops/secrets/staging\\.enc\\.env\$
           age: >-
             ${PUB_KEY}

  ${c_bold}2.${c_reset} If ops/secrets/prod.enc.env already exists, rotate it to include
     this key as a recipient:

       sops updatekeys ops/secrets/prod.enc.env
       sops updatekeys ops/secrets/staging.enc.env

     (If neither file exists yet, encrypt the template first — see
     ops/secrets/README.md "Migrating from the legacy plain .env".)

  ${c_bold}3.${c_reset} Commit the .sops.yaml change. Only the public key is in there —
     your private key (${KEY_FILE}) stays on this machine.

       git add .sops.yaml ops/secrets/
       git commit -m "ops/secrets: add ${LABEL} as an age recipient"
       git push

  ${c_bold}4.${c_reset} For CI / VPS deploy: paste the full contents of
     ${KEY_FILE} into the GitHub repo secret named ${c_bold}SOPS_AGE_KEY${c_reset}
     (Settings → Secrets and variables → Actions → New secret). The
     workflow at .github/workflows/deploy.yml uses it to decrypt at
     deploy time.

${c_yellow}Security${c_reset} — never commit the contents of ${KEY_FILE}. The repo's
top-level .gitignore covers .config/, but double-check ${KEY_FILE} is
not inside the repo working tree.

EOF
