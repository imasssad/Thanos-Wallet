FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY services/worker/package.json ./
RUN npm install --production=false

FROM deps AS build
COPY services/worker/src ./src
COPY services/worker/tsconfig.json ./
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist         ./dist

CMD ["node", "dist/worker.js"]
