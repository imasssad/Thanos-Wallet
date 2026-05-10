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
COPY packages/sdk-core/package.json     packages/sdk-core/
COPY packages/sdk-react/package.json    packages/sdk-react/
COPY packages/ui/package.json           packages/ui/

RUN pnpm install --filter @thanos/web... --frozen-lockfile=false

# Now copy source for web + its workspace deps
COPY apps/web              apps/web
COPY packages/sdk-core     packages/sdk-core
COPY packages/sdk-react    packages/sdk-react
COPY packages/ui           packages/ui

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
