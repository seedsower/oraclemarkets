# Oracle Markets — `curator` for Railway (cron: runs once and exits).
#
# Build from the repo root:  docker build -f workers/curator/Dockerfile -t oracle-curator .
# Secrets: CURATOR_KEYPAIR (dedicated devnet key; authority = resolver of every
# curated market), ANTHROPIC_API_KEY, REDIS_URL, PARTNER_MCP_AUTH_JSON (seed only).
# CURATOR_DRY_RUN defaults to true. It never resolves a market.

FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/sdk/ packages/sdk/
COPY workers/curator/ workers/curator/

RUN pnpm install --frozen-lockfile --filter @oracle-markets/curator...
RUN pnpm --filter @pm-amm/sdk build && pnpm --filter @oracle-markets/curator build
RUN pnpm --filter @oracle-markets/curator deploy --prod --legacy /out

FROM node:22-bookworm-slim AS runtime
WORKDIR /srv
ENV NODE_ENV=production
COPY --from=build --chown=node:node /out/ ./
USER node
CMD ["node", "dist/run.js"]
