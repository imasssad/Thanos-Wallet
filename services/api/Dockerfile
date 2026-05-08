FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY services/api/package.json ./
RUN npm install --production=false

# Build
FROM deps AS build
COPY services/api/src ./src
COPY services/api/tsconfig.json ./
RUN npm run build

# Production image
FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist         ./dist

EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["node", "dist/server.js"]
