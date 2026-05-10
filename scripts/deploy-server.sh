#!/usr/bin/env bash
# =============================================================================
# THANOS WALLET — ONE-SHOT SERVER DEPLOY (Ubuntu 22.04 / 24.04)
# =============================================================================
# Run on a fresh VPS as root (or with sudo). Idempotent — safe to re-run.
# After this finishes, the API is reachable at http://<server-ip>:4000/health
#
# Usage on the server:
#   curl -fsSL https://raw.githubusercontent.com/imasssad/Thanos-Wallet/main/scripts/deploy-server.sh | bash
# OR copy this whole file in via scp and run:
#   bash deploy-server.sh
# =============================================================================

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/imasssad/Thanos-Wallet.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/thanos-wallet}"
GIT_BRANCH="${GIT_BRANCH:-main}"

echo ""
echo "============================================="
echo " Thanos Wallet — server deploy"
echo "============================================="
echo "  Install dir : $INSTALL_DIR"
echo "  Repo        : $REPO_URL"
echo "  Branch      : $GIT_BRANCH"
echo ""

# ─── 1. Install Docker + Compose if missing ──────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  echo "[1/6] Installing Docker..."
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg git
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  echo "  ✓ Docker installed"
else
  echo "[1/6] Docker already installed"
fi

# ─── 2. Firewall (allow only SSH + 80/443; keep DB ports closed) ────────────
if command -v ufw >/dev/null 2>&1; then
  echo "[2/6] Configuring firewall (UFW)..."
  ufw --force enable
  ufw allow 22/tcp   # SSH
  ufw allow 80/tcp   # HTTP (for Let's Encrypt + nginx)
  ufw allow 443/tcp  # HTTPS
  ufw deny  5432     # Postgres — never expose
  ufw deny  6379     # Redis    — never expose
  ufw deny  4000     # API      — only via nginx
  ufw deny  4010     # Indexer  — only via nginx
  echo "  ✓ Firewall configured"
else
  echo "[2/6] UFW not installed; skipping firewall (configure manually)"
fi

# ─── 3. Clone or update the repo ────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "[3/6] Repo exists, pulling latest..."
  cd "$INSTALL_DIR"
  git fetch origin "$GIT_BRANCH"
  git reset --hard "origin/$GIT_BRANCH"
else
  echo "[3/6] Cloning $REPO_URL ..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --branch "$GIT_BRANCH" "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ─── 4. Create .env from template if missing ────────────────────────────────
if [ ! -f .env ]; then
  echo "[4/6] Creating .env from .env.example with random secrets..."
  POSTGRES_PASS=$(openssl rand -hex 24)
  REDIS_PASS=$(openssl rand -hex 24)
  JWT_SECRET=$(openssl rand -hex 32)
  cp .env.example .env
  sed -i "s|CHANGE_THIS_STRONG_PASSWORD|$POSTGRES_PASS|g" .env
  sed -i "s|CHANGE_THIS_REDIS_PASSWORD|$REDIS_PASS|g" .env
  sed -i "s|CHANGE_THIS_JWT_SECRET_MIN_32_CHARS|$JWT_SECRET|g" .env
  chmod 600 .env
  echo "  ✓ Generated .env with random Postgres + Redis + JWT secrets"
  echo "  → Postgres password saved in .env (root-readable only)"
else
  echo "[4/6] .env already exists — keeping it"
fi

# ─── 5. Build and start services ─────────────────────────────────────────────
echo "[5/6] Building images and starting services (this takes ~3-5 min)..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull --ignore-pull-failures || true
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# ─── 6. Health check ─────────────────────────────────────────────────────────
echo "[6/6] Waiting for services to come up..."
sleep 15
echo ""
echo "── Container status ──"
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
echo ""
echo "── API health ──"
curl -s -m 10 http://localhost:4000/health || echo "  (API not responding yet — check logs with: docker compose logs api)"
echo ""
echo "── Indexer health ──"
curl -s -m 10 http://localhost:4010/health || echo "  (Indexer not responding yet — check logs with: docker compose logs indexer)"
echo ""
echo "============================================="
echo " DEPLOY DONE"
echo "============================================="
echo ""
echo "Next steps:"
echo "  - Tail logs: cd $INSTALL_DIR && docker compose logs -f api"
echo "  - Restart:   cd $INSTALL_DIR && docker compose -f docker-compose.yml -f docker-compose.prod.yml restart"
echo "  - Update:    cd $INSTALL_DIR && git pull && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build"
echo ""
echo "  - Set up nginx + SSL for https://api.yourdomain.com → http://localhost:4000"
echo "    (apt install -y nginx certbot python3-certbot-nginx)"
echo ""
