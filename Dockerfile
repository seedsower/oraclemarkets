# Oracle Markets — `web` service (Next.js standalone) for Railway.
#
# Build from the repo root:  docker build -t oracle-web .
# Only `app/` + `packages/sdk/` are built; `anchor/` never enters the image
# (see .dockerignore). Railway passes service variables as build args for every
# ARG declared below — NEXT_PUBLIC_* values are inlined into the client bundle
# at build time, so changing one requires a rebuild, not just a restart.

FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
ENV NEXT_TELEMETRY_DISABLED=1

ARG NEXT_PUBLIC_SOLANA_CLUSTER=devnet
ARG NEXT_PUBLIC_RPC_URL
ARG NEXT_PUBLIC_PROGRAM_ID=GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y
ARG NEXT_PUBLIC_USDC_MINT=3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_X_HANDLE
ARG NEXT_PUBLIC_FEATURED_AUTHORITIES
ARG NEXT_PUBLIC_FAUCET_URL
ENV NEXT_PUBLIC_SOLANA_CLUSTER=$NEXT_PUBLIC_SOLANA_CLUSTER \
    NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL \
    NEXT_PUBLIC_PROGRAM_ID=$NEXT_PUBLIC_PROGRAM_ID \
    NEXT_PUBLIC_USDC_MINT=$NEXT_PUBLIC_USDC_MINT \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_X_HANDLE=$NEXT_PUBLIC_X_HANDLE \
    NEXT_PUBLIC_FEATURED_AUTHORITIES=$NEXT_PUBLIC_FEATURED_AUTHORITIES \
    NEXT_PUBLIC_FAUCET_URL=$NEXT_PUBLIC_FAUCET_URL

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .prettierrc ./
COPY packages/sdk/ packages/sdk/
COPY app/ app/

RUN pnpm install --frozen-lockfile --filter app...
RUN pnpm --filter @pm-amm/sdk build && pnpm --filter app build

FROM node:22-bookworm-slim AS runtime
WORKDIR /srv
ENV NODE_ENV=production HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
# PORT is injected by Railway; Next's standalone server reads it (default 3000).

COPY --from=build --chown=node:node /repo/app/.next/standalone/ ./
COPY --from=build --chown=node:node /repo/app/.next/static ./app/.next/static
COPY --from=build --chown=node:node /repo/app/public ./app/public

USER node
CMD ["node", "app/server.js"]
