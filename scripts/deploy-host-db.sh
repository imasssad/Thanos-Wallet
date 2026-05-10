#!/usr/bin/env bash
# =============================================================================
# THANOS WALLET — DEPLOY USING HOST'S POSTGRES + REDIS
# =============================================================================
# Use when Postgres is already installed on the server (apt-installed).
# Only the API + indexer + worker run in Docker; data tier is host-native.
#
# Usage on the server (as root):
#   bash deploy-host-db.sh
# =============================================================================

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/imasssad/Thanos-Wallet.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/thanos-wallet}"
GIT_BRANCH="${GIT_BRANCH:-main}"
DB_NAME="${DB_NAME:-thanos_wallet}"
DB_USER="${DB_USER:-thanos}"

echo ""
echo "============================================="
echo " Thanos Wallet — host-Postgres deploy"
echo "============================================="
echo ""

# ─── 1. Install Docker if missing ────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  echo "[1/7] Installing Docker..."
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg git
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi
echo "[1/7] Docker ready"

# ─── 2. Verify host Postgres exists ─────────────────────────────────────────
if ! command -v psql >/dev/null 2>&1; then
  echo "[2/7] Postgres not installed on host. Install it first:"
  echo "      apt install -y postgresql postgresql-contrib"
  echo "      systemctl enable --now postgresql"
  exit 1
fi
echo "[2/7] Host Postgres detected: $(psql --version)"

# ─── 3. Verify/install Redis ────────────────────────────────────────────────
if ! command -v redis-cli >/dev/null 2>&1; then
  echo "[3/7] Installing Redis on host..."
  apt-get install -y redis-server
  systemctl enable --now redis-server
fi
echo "[3/7] Host Redis: $(redis-cli --version)"

# ─── 4. Create DB + user (idempotent) ───────────────────────────────────────
DB_PASS=$(openssl rand -hex 24)
REDIS_PASS=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)

# Create role + database via the postgres OS user
sudo -u postgres psql <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS';
  ELSE
    ALTER ROLE $DB_USER WITH PASSWORD '$DB_PASS';
  END IF;
END \$\$;
SQL

if ! sudo -u postgres psql -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
echo "[4/7] DB '$DB_NAME' + user '$DB_USER' ready"

# ─── 5. Configure Redis password ────────────────────────────────────────────
if grep -q "^# requirepass" /etc/redis/redis.conf 2>/dev/null; then
  sed -i "s|^# requirepass .*|requirepass $REDIS_PASS|" /etc/redis/redis.conf
elif ! grep -q "^requirepass" /etc/redis/redis.conf 2>/dev/null; then
  echo "requirepass $REDIS_PASS" >> /etc/redis/redis.conf
else
  sed -i "s|^requirepass .*|requirepass $REDIS_PASS|" /etc/redis/redis.conf
fi
systemctl restart redis-server
echo "[5/7] Redis password set"

# ─── 6. Clone or update repo ────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  cd "$INSTALL_DIR"
  git fetch origin "$GIT_BRANCH"
  git reset --hard "origin/$GIT_BRANCH"
else
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --branch "$GIT_BRANCH" "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# Apply schema if it hasn't been applied
if [ -f "services/db/schema.sql" ]; then
  PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -f services/db/schema.sql || true
fi

# Generate .env pointing to HOST services (host.docker.internal from container)
cat > .env <<ENV
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@host.docker.internal:5432/$DB_NAME
REDIS_URL=redis://:$REDIS_PASS@host.docker.internal:6379
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=15m
REFRESH_EXPIRES_IN=30d
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX=100

LITHO_RPC_PRIMARY=https://rpc.litho.ai
LITHO_RPC_FALLBACK=https://rpc-fallback.litho.ai
LITHO_CHAIN_ID=700777
ETH_RPC_URL=https://eth.llamarpc.com
BNB_RPC_URL=https://bsc-dataseed.binance.org
BTC_RPC_URL=https://blockstream.info/api
SOL_RPC_URL=https://api.mainnet-beta.solana.com
PRICE_API_URL=https://api.coingecko.com/api/v3
ENV
chmod 600 .env
echo "[6/7] .env generated"

# ─── 7. Start API + indexer + worker + web (no postgres/redis containers) ──
echo "[7/7] Building + starting services..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.host-db.yml \
  up -d --build api indexer worker web

sleep 10
echo ""
echo "── Container status ──"
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.host-db.yml ps
echo ""
echo "── API health ──"
curl -s -m 10 http://localhost:4000/health || echo "  (not responding yet — check: docker compose logs api)"
echo ""
echo "============================================="
echo " DONE"
echo "============================================="
echo ""
echo "Database:  postgresql://$DB_USER:***@127.0.0.1:5432/$DB_NAME"
echo "Redis:     redis://:***@127.0.0.1:6379"
echo "API:       http://localhost:4000  (only via nginx for public)"
echo ""
echo "Secrets are in $INSTALL_DIR/.env (root-readable only)"
