# Oracle Markets — `keeper` worker for Railway.
#
# Build from the repo root:  docker build -f workers/keeper/Dockerfile -t oracle-keeper .
# Holds NO program-upgrade, resolution, or mint key. The only optional secret is
# KEEPER_KEYPAIR, a dedicated low-balance hot wallet used for permissionless `accrue`.

FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/sdk/ packages/sdk/
COPY workers/keeper/ workers/keeper/

RUN pnpm install --frozen-lockfile --filter @oracle-markets/keeper...
RUN pnpm --filter @pm-amm/sdk build && pnpm --filter @oracle-markets/keeper build
# Self-contained copy: keeper dist + prod node_modules (SDK included, no dev deps).
RUN pnpm --filter @oracle-markets/keeper deploy --prod --legacy /out

FROM node:22-bookworm-slim AS runtime
WORKDIR /srv
ENV NODE_ENV=production
COPY --from=build --chown=node:node /out/ ./
USER node
CMD ["node", "dist/index.js"]
