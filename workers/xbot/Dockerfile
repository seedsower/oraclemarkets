# Oracle Markets — `xbot` mention bot for Railway.
#
# Build from the repo root:  docker build -f workers/xbot/Dockerfile -t oracle-xbot .
# Holds no wallet or program key. Its only secrets are the bot account's X
# OAuth 2.0 credentials. It replies with links and never trades. XBOT_DRY_RUN
# defaults to true.

FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/sdk/ packages/sdk/
COPY workers/xbot/ workers/xbot/

RUN pnpm install --frozen-lockfile --filter @oracle-markets/xbot...
RUN pnpm --filter @pm-amm/sdk build && pnpm --filter @oracle-markets/xbot build
# Self-contained copy: xbot dist + prod node_modules (SDK included, no dev deps).
RUN pnpm --filter @oracle-markets/xbot deploy --prod --legacy /out

FROM node:22-bookworm-slim AS runtime
WORKDIR /srv
ENV NODE_ENV=production
COPY --from=build --chown=node:node /out/ ./
USER node
CMD ["node", "dist/index.js"]
