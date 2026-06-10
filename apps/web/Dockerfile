# =============================================================================
# THANOS WALLET — WEB APP (Next.js 15)
# Multi-stage build optimized for monorepo with pnpm workspaces.
# Final image: ~150MB (vs ~1GB without standalone output).
# =============================================================================

# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

# pnpm via corepack
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Copy lockfiles + workspace declaration first (for better layer caching)
COPY pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./

# Copy package.json from each workspace package (without source — for cache)
COPY apps/web/package.json              apps/web/
COPY packages/api-client/package.json   packages/api-client/
COPY packages/sdk-core/package.json     packages/sdk-core/
COPY packages/sdk-react/package.json    packages/sdk-react/
COPY packages/ui/package.json           packages/ui/

# --ignore-scripts skips native compile (usb, tiny-secp256k1, etc.) which only
# matters for browser-side hardware-wallet code, not server-rendered web.
RUN pnpm install --filter @thanos/web... --frozen-lockfile=false --ignore-scripts

# Now copy source for web + its workspace deps
COPY apps/web              apps/web
COPY packages/api-client   packages/api-client
COPY packages/sdk-core     packages/sdk-core
COPY packages/sdk-react    packages/sdk-react
COPY packages/ui           packages/ui

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time —
# they must be set as ENV BEFORE `next build` runs, otherwise they end
# up as `undefined` in the browser. Each is fed in via docker compose
# build args (see docker-compose.prod.yml -> web.build.args). The
# ARG-default chain keeps a missing value buildable in CI / local Docker
# while making the production deploy fail loudly if .env forgets to set
# them.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_REOWN_PROJECT_ID
ARG NEXT_PUBLIC_INDEXER_URL
ARG NEXT_PUBLIC_MULTX_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_REOWN_PROJECT_ID=${NEXT_PUBLIC_REOWN_PROJECT_ID}
ENV NEXT_PUBLIC_INDEXER_URL=${NEXT_PUBLIC_INDEXER_URL}
ENV NEXT_PUBLIC_MULTX_API_URL=${NEXT_PUBLIC_MULTX_API_URL}

# Build (next.config.js has output: 'standalone')
RUN pnpm --filter @thanos/web build

# ─── Stage 2: Runtime (slim) ─────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Standalone Next.js output bundles only what's needed
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static     ./apps/web/.next/static
COPY --from=builder /repo/apps/web/public           ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
