# Coding prompt — Launch "Oracle Markets" on Railway

Paste everything below the line into Claude Code (or another coding agent) at the root of your fork of `sparkfun-labs/pm-amm`.

---

## Role and goal

You are working in a fork of `sparkfun-labs/pm-amm`, a pnpm monorepo implementing the Paradigm pm-AMM prediction market on Solana. Rebrand the user-facing product to **Oracle Markets** and make it deploy cleanly on **Railway** (instead of Vercel), as three Railway services: `web` (Next.js), `redis` (Railway Redis template), and `keeper` (a Node worker). Work in the phases below, commit after each phase, and keep all existing tests and the type-check green.

## Facts about the repo (verified — do not re-derive)

- Workspace: `pnpm@10.33.0` (see root `package.json` `packageManager`), Node >= 20. Workspace packages: `app` (Next.js 16.2 App Router, React 19, Tailwind 4, Turbopack) and `packages/sdk` (`@pm-amm/sdk`, built by `tsup`; its `prepare` script builds `dist/` on install). `anchor/` is deliberately NOT in the workspace — never touch it or add it to the Railway build.
- Build today (Vercel): `pnpm install` at root → `pnpm --filter @pm-amm/sdk build` → `pnpm --filter app build`. `app/vercel.json` and `.vercelignore` encode this.
- Verified: with `output: "standalone"`, `outputFileTracingRoot` and `turbopack.root` set to the repo root, `next build` succeeds and emits `app/.next/standalone/app/server.js`; after copying `.next/static` and `public` beside it, `node server.js` serves `/`, `/markets`, `/api/*` correctly. Standalone size ≈ 52 MB.
- `app/src/app/layout.tsx` uses `next/font/google` (Inter Tight, JetBrains Mono) — the build needs outbound access to Google Fonts.
- `app/src/app/opengraph-image.tsx` uses `runtime = "edge"`; this works under `next start`/standalone.
- Client config is all `NEXT_PUBLIC_*` and is **inlined at build time**: `NEXT_PUBLIC_SOLANA_CLUSTER` (`devnet` | `mainnet-beta` | `localnet`), `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_PROGRAM_ID` (default `GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y`), `NEXT_PUBLIC_USDC_MINT` (default devnet mock `3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ`; mainnet `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`). `NEXT_PUBLIC_DEV_WALLET_SECRET` must NEVER be set in any Railway environment.
- Server secrets: `MINT_AUTHORITY_KEY` (base64 64-byte secret, devnet faucet only; the faucet route hard-503s on mainnet), `KV_REST_API_URL` / `KV_REST_API_TOKEN` (Upstash REST), plus `FAUCET_*` tuning vars documented in `DEVNET.md`.
- `app/src/lib/redis.ts` uses `@upstash/redis` (HTTP REST). Railway's Redis is plain TCP (`REDIS_URL`), so the current client cannot talk to it.
- `app/src/lib/rate-limit.ts` falls back to an in-memory Map without Redis; `clientIp()` reads `x-forwarded-for` (Railway's edge also sets it).
- `/api/price-snap` is **unauthenticated**: browsers POST `{marketId, price, timestamp}` from `app/src/hooks/use-price-recorder.ts`, so anyone can write fake chart points. `/api/price-history` reads a Redis sorted set `market:<pubkey>:prices` whose members are JSON `{t, p}`.
- Market list: `app/src/hooks/use-markets.ts` calls `getClient(connection).fetchAllMarkets(443)` from the browser — a `getProgramAccounts` call per page load, which is expensive and often restricted on mainnet RPCs. Groups/vaults hooks do the same.
- SDK exposes `client.send.accrue(market)` / `client.ix.accrue({ market })`. `accrue` is permissionless.
- The protocol fee DAO (`4qXy…QEph`) is compiled into `anchor/programs/pm_amm/src/instructions/swap.rs` and mirrored in `packages/sdk/src/constants.ts`. Do NOT change it in this task (see "Out of scope").
- Identifiers like `@pm-amm/sdk`, `PmAmmClient`, `pm-amm-client.ts`, `pm_amm` IDL names are code, not branding. Do not rename them.

## Phase 1 — Railway-ready build for the `web` service

1. `app/next.config.ts`: add `output: "standalone"`, `outputFileTracingRoot: path.join(__dirname, "..")`, and `turbopack: { root: path.join(__dirname, "..") }`. Keep `serverExternalPackages: ["@anchor-lang/core"]`.
2. Add a root `Dockerfile` (multi-stage, `node:22-bookworm-slim`):
   - Enable corepack and `corepack prepare pnpm@10.33.0 --activate`.
   - Copy only what the web build needs: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `app/`, `packages/sdk/`, `.prettierrc` if referenced. Use a `.dockerignore` that excludes `anchor/`, `oracle/`, `doc/`, `examples/`, `.surfpool/`, `**/node_modules`, `**/.next`, `packages/*/dist`, `.env*`, `.git`.
   - Declare `ARG` + `ENV` for every `NEXT_PUBLIC_*` variable listed above plus the new branding vars from Phase 3 (Railway passes service variables as Docker build args when the Dockerfile declares them).
   - `pnpm install --frozen-lockfile`, then `pnpm --filter @pm-amm/sdk build`, then `pnpm --filter app build`.
   - Runtime stage: copy `app/.next/standalone/` to `/srv`, `app/.next/static` to `/srv/app/.next/static`, `app/public` to `/srv/app/public`. Run as non-root user. `ENV HOSTNAME=0.0.0.0 NODE_ENV=production`. `CMD ["node", "app/server.js"]` from `/srv`. Do not hardcode `PORT` (Railway injects it; Next standalone honors it).
3. Add `app/src/app/api/health/route.ts` returning `{ ok: true, cluster, programId, redis: "tcp" | "upstash" | "none" }` with `dynamic = "force-dynamic"`; no RPC calls (health checks must not burn RPC quota).
4. Add `/railway/web.json` (config-as-code; the path is absolute from repo root because Railway config does not follow Root Directory):
   ```json
   {
     "$schema": "https://railway.com/railway.schema.json",
     "build": {
       "builder": "DOCKERFILE",
       "dockerfilePath": "Dockerfile",
       "watchPatterns": ["app/**", "packages/sdk/**", "pnpm-lock.yaml", "Dockerfile", "railway/web.json"]
     },
     "deploy": {
       "healthcheckPath": "/api/health",
       "healthcheckTimeout": 60,
       "restartPolicyType": "ON_FAILURE",
       "restartPolicyMaxRetries": 5
     }
   }
   ```
5. Leave `app/vercel.json` and `.vercelignore` in place (harmless) but note in docs that Railway is now primary.
6. Verify locally: `docker build` with devnet build args, `docker run -e PORT=8080 -p 8080:8080`, then `curl /api/health`, `/`, `/markets`.

## Phase 2 — Redis portability (Railway TCP Redis first, Upstash fallback)

1. Add `ioredis` to `app`. Rewrite `app/src/lib/redis.ts` to export a small `KvStore` interface covering exactly the operations used in the codebase: `incr`, `decr`, `expire`, `ttl`, `zadd(key, score, member)`, `zrange(key, start, stop, { withScores? })`, `zcard`, `zremrangebyrank`, `get`, `set(key, value, { ex? })`.
2. Selection order: `REDIS_URL` → ioredis adapter (lazy singleton, `maxRetriesPerRequest: 2`, `enableOfflineQueue: false`, and `family: 0` so Railway private networking over IPv6 works); else `KV_REST_API_URL` + `KV_REST_API_TOKEN` → Upstash adapter; else `null`. Export `redisKind` for the health route.
3. Normalize return shapes so callers don't care which backend is active (ioredis returns strings and flat `[member, score, ...]` arrays for `WITHSCORES`; Upstash may return parsed JSON). Update `rate-limit.ts`, `api/price-history`, and `api/price-snap` to the interface. Keep the in-memory fallback in `rate-limit.ts`.
4. Any Redis error in a request path must degrade gracefully (empty price history, in-memory rate limit) rather than 500.
5. Add a unit test (vitest or node:test, whichever is lighter to add to `app`) for the ioredis `zrange withScores` normalization.

## Phase 3 — Rebrand to Oracle Markets (user-facing only)

1. Create `app/src/lib/brand.ts` exporting `BRAND = { name: "Oracle Markets", shortName: "Oracle", tagline, description, siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000", xHandle?: process.env.NEXT_PUBLIC_X_HANDLE }`. Tagline default: "Prediction markets on Solana". Description default: "Trade on real-world outcomes with an AMM built for prediction markets — Paradigm's pm-AMM, live on Solana."
2. Replace user-visible "pm-AMM" / "pm-amm" / "pm/amm" strings across `app/src` (≈35 files contain matches; most are code identifiers — only change display text, titles, alt text, toasts, and copy). Key spots: `layout.tsx` metadata (`metadataBase` from `BRAND.siteUrl`, title template `%s · Oracle Markets`), `opengraph-image.tsx`, `components/ui/wordmark.tsx`, `components/layout/landing-nav.tsx`, `components/layout/sidebar.tsx`, `components/layout/status-bar.tsx`, `app/page.tsx`, `app/docs/page.tsx`.
3. Redesign `Wordmark` for Oracle Markets using the existing design tokens in `app/src/styles/tokens.css` (keep the bracketed-glyph idea: an "O" mark in the mono box + "oracle/markets" lockup with the dim slash). Regenerate `app/src/app/favicon.ico` to match (a simple SVG → ICO is fine; add `app/src/app/icon.svg` too).
4. Where the product explains its engine (landing, docs), keep accurate technical attribution: "Powered by the Paradigm pm-AMM (Moallemi & Robinson, 2024)" and a footer link to the upstream MIT-licensed repo. Keep the `LICENSE` file intact.
5. `app/public/llms.txt` and `app/public/api-reference.md`: replace hardcoded `https://pm-amm-devnet.vercel.app` with the new site URL placeholder and rebrand the prose, keeping all instruction names and SDK references unchanged.
6. Resolution honesty: on market pages, the resolver is the market authority (admin resolution; there is no on-chain oracle). Add a small "Resolved by" row showing the authority address (Solscan link via existing `solscanAccountUrl`) and, if the market name contains a URL or the future `resolutionSource` field exists, show it. Do not claim oracle-based resolution anywhere in copy.

## Phase 4 — Stop trusting browsers for price history

1. Remove the call to `usePriceRecorder` from the UI (keep the hook file or delete it — your choice, but no client should write price points).
2. Protect `POST /api/price-snap`: require header `x-oracle-keeper-secret` equal to `KEEPER_SHARED_SECRET` (constant-time compare); 401 otherwise; 503 if the secret is unset. Validate `price` in `[0, 1]`, `marketId` is a valid base58 pubkey, and `timestamp` within ±10 min of server time.
3. `/api/price-history` stays public but add `Cache-Control: public, s-maxage=10, stale-while-revalidate=30`.

## Phase 5 — `keeper` worker service (indexer + price recorder + optional accrue)

Create `workers/keeper/` as a new workspace package (`add "workers/*"` to `pnpm-workspace.yaml`), TypeScript, run with `tsx` or compiled with `tsup`. It depends on `@pm-amm/sdk` (`workspace:*`), `@solana/web3.js`, `@anchor-lang/core`, `ioredis`.

Loop (interval `KEEPER_INTERVAL_SECS`, default 20):
1. Build a read-only SDK client against `KEEPER_RPC_URL` (a server-side RPC key, separate from the browser's `NEXT_PUBLIC_RPC_URL`) and `PROGRAM_ID`.
2. `fetchAllMarkets(443)`, `fetchAllGroups()`, `fetchAllVaults()`; compute each market's display price using the same math as `app/src/hooks/use-markets.ts` — extract that pure computation into a shared function (e.g. `packages/sdk/src/math.ts` or a new `app/src/lib/market-view.ts` that the keeper imports) so browser and keeper can't drift.
3. Write a JSON snapshot of the decoded, display-ready lists to Redis keys `cache:markets`, `cache:groups`, `cache:vaults` with `EX 120`, plus `cache:updated_at`.
4. For each unresolved, unexpired market, append `{t, p}` to `market:<pubkey>:prices` if the price moved ≥ 0.2% or 5 minutes have passed since the last point; trim to 500 members. Write directly to Redis (no HTTP hop).
5. Optional accrue (off unless `KEEPER_ACCRUE_ENABLED=true` and `KEEPER_KEYPAIR` (base64) is set): every `KEEPER_ACCRUE_EVERY_SECS` (default 3600) call `accrue(market)` on active markets with LP shares, with a priority fee (`KEEPER_PRIORITY_MICROLAMPORTS`, default 5000), stopping entirely if the keeper wallet balance is below `KEEPER_MIN_SOL` (default 0.05). This key must be a fresh, dedicated hot wallet with no authority over anything.
6. Structured JSON logs, a `SIGTERM` handler that finishes the current tick, exponential backoff on RPC 429s, and never crash the process on a single market's error.
7. Add `/railway/keeper.json` with builder `DOCKERFILE`, `dockerfilePath: "workers/keeper/Dockerfile"`, watch patterns for `workers/keeper/**` and `packages/sdk/**`, restart policy `ALWAYS`, no healthcheck path.

Then in `web`:
- Add `GET /api/markets`, `/api/groups`, `/api/vaults` that return the cached JSON (plus `updatedAt`) or `503` if the cache is empty.
- Change `useMarkets`, `useGroups`, `useVaults`, `useVaultGroups` to try the API first and fall back to the current direct RPC fetch when it returns non-200 or `updatedAt` is older than 90 s. Keep the `MarketData` shape identical. After a user's own transaction, still invalidate and allow an immediate direct RPC refresh so their trade shows without waiting for the keeper.

## Phase 6 — Curated market list

Anyone can create markets on the shared program, so the default list should be curated:
- `NEXT_PUBLIC_FEATURED_AUTHORITIES` (comma-separated pubkeys). When set, `/` and `/markets` default to markets/groups/vaults whose `authority` is in the list, with an "All markets" toggle that shows everything with a subtle "community" badge. When unset, behave as today.

## Phase 7 — Docs and env templates

1. `RAILWAY.md` at repo root: architecture diagram (web ↔ redis ↔ keeper, both talking to Solana RPC), step-by-step Railway setup (create project from GitHub repo, add Redis template, create `web` and `keeper` services with their config file paths `/railway/web.json` and `/railway/keeper.json`, reference variables like `REDIS_URL=${{Redis.REDIS_URL}}`, generate a domain, attach custom domain), a devnet and a mainnet env table per service, and a smoke-test checklist.
2. `railway/.env.web.devnet.example`, `railway/.env.web.mainnet.example`, `railway/.env.keeper.example` — templates only, no secrets. Mainnet templates must omit `MINT_AUTHORITY_KEY` and include a comment that the faucet is disabled on mainnet.
3. Update the root README top section to name the product Oracle Markets, while keeping the technical pm-AMM documentation and the upstream credit.

## Acceptance criteria

- `pnpm install --frozen-lockfile && pnpm --filter @pm-amm/sdk build && pnpm type-check && pnpm lint` pass. `pnpm run test:rust` still passes (you did not touch Rust).
- `docker build .` and `docker build -f workers/keeper/Dockerfile .` both succeed from the repo root.
- Running web + keeper + a local `redis:7` via a new `docker-compose.yml` against devnet: `/api/health` 200, `/api/markets` returns cached markets within one keeper interval, charts populate from keeper-written points, `POST /api/price-snap` without the secret returns 401.
- No user-visible "pm-AMM"/"pm/amm" branding remains except explicit engine attribution.
- `grep -r NEXT_PUBLIC_DEV_WALLET_SECRET railway/` returns nothing.

## Out of scope (do not do)

- Do not modify anything under `anchor/`, redeploy the program, change `declare_id!`, or change `PROTOCOL_DAO`. Running your own program instance (own program ID, own fee DAO, own upgrade authority) is a separate, deliberate project.
- Do not add any code path that holds a program upgrade key, market-resolution key, or mainnet mint authority on Railway.
