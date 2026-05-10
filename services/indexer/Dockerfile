FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY services/indexer/package.json ./
RUN npm install --production=false

FROM deps AS build
COPY services/indexer/src ./src
COPY services/indexer/tsconfig.json ./
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist         ./dist

EXPOSE 4010
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:4010/health || exit 1

CMD ["node", "dist/server.js"]
