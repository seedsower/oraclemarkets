# Deploying Oracle Markets on Railway

Railway is now the primary host for the Oracle Markets front end. The Vercel
files (`app/vercel.json`, `.vercelignore`) are still in the repo and still work,
but new deployments should follow this guide.

The on-chain program is **not** deployed from here. Oracle Markets runs against
the existing pm-AMM program (`97ySR6vWkxCC1oPbB2ytRSmKos4mExanuTu2e9VmoXcX`, the
same ID on devnet and mainnet). No Railway service holds an upgrade key, a
resolution key, or a mainnet mint authority.

## Architecture

```
                    ┌──────────────────────── Railway project ────────────────────────┐
                    │                                                                  │
  browser ──HTTPS──▶│  web  (Next.js standalone, /Dockerfile)                          │
     │              │   ├─ pages + /api/health                                         │
     │              │   ├─ GET /api/{markets,groups,vaults,vault-groups} ◀─┐           │
     │              │   ├─ GET /api/price-history ◀────────────────────────┤ reads     │
     │              │   └─ /api/faucet (devnet only), rate limits ─────────┤           │
     │              │                                                      │           │
     │              │  Redis  (Railway template, private network)  ◀───────┘           │
     │              │   ▲  cache:* lists (EX 120) + market:<pk>:prices                 │
     │              │   │ writes                                                       │
     │              │  keeper  (Node worker, workers/keeper/Dockerfile)                │
     │              │   └─ every 20 s: getProgramAccounts ×4 → views → Redis;          │
     │              │      chart points; optional accrue (dedicated hot wallet)        │
     │              └────────────────────────────┬─────────────────────────────────────┘
     │                                           │ KEEPER_RPC_URL (server key)
     │ NEXT_PUBLIC_RPC_URL (browser key)         ▼
     └──────────────────────────────────▶  Solana RPC  ──▶  pm-AMM program
       wallet txs, single-account reads,
       list fallback when the cache is stale
```

- **web** serves the app. Lists come from the keeper's Redis cache first. The
  browser falls back to direct RPC reads when `/api/<list>` returns non-200 or
  data older than 90 s, for 60 s after the user's own transaction, and when a
  detail page can't find something the user just created.
- **keeper** is the only writer of chart history. Browsers can no longer post
  price points. `POST /api/price-snap` needs the `x-oracle-keeper-secret` header.
- **Redis** is Railway's TCP Redis (`REDIS_URL`). Upstash REST
  (`KV_REST_API_URL` + `KV_REST_API_TOKEN`) still works as a fallback when
  `REDIS_URL` is unset. When Redis is unavailable, the app keeps working: rate
  limits fall back to memory, charts show nothing, and lists come from RPC.

## One-time setup

Railway no longer accepts a `railway.json` config-file path on new services
(config-as-code is deprecated in favour of `.railway/railway.ts`). The files in
`railway/*.json` remain as a reference for the values below, which you set
directly in each service's _Settings_.

1. **Create the project.** In Railway, choose _New Project → Deploy from GitHub
   repo_ and pick your fork. Railway detects the pnpm workspace and may create
   one service per package (`app`, `@pm-amm/sdk`, `@oracle-markets/keeper`), each
   with a `pnpm --filter … start` start command. **Those start commands fail**:
   the Docker images contain no pnpm. Keep `app` (the web service) and
   `@oracle-markets/keeper`, and delete `@pm-amm/sdk` (it's a library, not a
   service).
2. **Configure the web service** (`app`) under _Settings_:
   - _Root Directory_: empty (repo root)
   - _Dockerfile path_: `Dockerfile`
   - _Custom Start Command_: `node app/server.js`
   - _Healthcheck Path_: `/api/health` (timeout 60 s)
   - _Watch Paths_: `app/**`, `packages/sdk/**`, `pnpm-lock.yaml`, `Dockerfile`
3. **Configure the keeper** (`@oracle-markets/keeper`) under _Settings_:
   - _Dockerfile path_: `workers/keeper/Dockerfile`
   - _Custom Start Command_: `node dist/index.js`
   - _Restart Policy_: Always; no healthcheck and no domain (it serves no HTTP)
   - _Watch Paths_: `workers/keeper/**`, `packages/sdk/**`, `pnpm-lock.yaml`

   Without the Dockerfile path, the keeper builds the root (web) Dockerfile and
   crashes on start.

4. **Add Redis.** Choose _+ New → Database → Redis_. Keep the service name
   `Redis`, so the `${{Redis.REDIS_URL}}` references below resolve.
5. **Variables.** Paste a template into each service's _Variables → Raw Editor_
   and fill in the blanks:
   - web: [`railway/.env.web.devnet.example`](railway/.env.web.devnet.example)
     or [`railway/.env.web.mainnet.example`](railway/.env.web.mainnet.example)
   - keeper: [`railway/.env.keeper.example`](railway/.env.keeper.example)

   Railway resolves `REDIS_URL=${{Redis.REDIS_URL}}` to Redis's private URL
   (`*.railway.internal`, reachable over IPv6; both Redis clients set `family: 0`).

6. **Domain.** Go to _web → Settings → Networking → Generate Domain_. Once a
   custom domain is attached (_+ Custom Domain_, then add the CNAME record Railway
   shows at your DNS provider), set `NEXT_PUBLIC_SITE_URL` to it and **redeploy**.
7. **Deploy from the latest commit** (_Deploy → Deploy latest commit_, or push).
   _Redeploy_ on an old failed deployment reuses that deployment's settings,
   including the broken start command.

### Optional: the `xbot` mention bot

A third worker answers `@mentions` on X with market links (see
[`workers/xbot/README.md`](workers/xbot/README.md)). It's a separate service from
the same repo, set up like the keeper:
_Dockerfile path_ `workers/xbot/Dockerfile`, _Custom Start Command_
`node dist/index.js`, _Restart Policy_ Always, no domain, and _Watch Paths_
`workers/xbot/**`, `packages/sdk/**`, `pnpm-lock.yaml`. Variables:
[`railway/.env.xbot.example`](railway/.env.xbot.example). It idles until the X
credentials are set, and stays in dry run until `XBOT_DRY_RUN=false`.

### Optional: the `curator` (markets from oraclemarkets.io)

A cron job that opens markets from the partner's top AI-forecast questions per
category (spec: [`doc/ORACLE_CURATOR_PROMPT.md`](doc/ORACLE_CURATOR_PROMPT.md)).
It runs once and **exits**: Railway cron skips a run while the previous one is
still running, so a process that never exits would block every later run.

- _Dockerfile path_ `workers/curator/Dockerfile`, _Custom Start Command_
  `node dist/run.js`, _Restart Policy_ **Never**, no domain, _Watch Paths_
  `workers/curator/**`, `packages/sdk/**`, `pnpm-lock.yaml`, `railway/curator.json`.
- _Cron Schedule_ `0 14 */3 * *` (UTC: 14:00 = 7 a.m. Mountain in winter, 8 a.m.
  in summer). `*/3` restarts each month, so two runs are sometimes 1–2 days
  apart. **Check the schedule in the service's Settings after the first deploy**:
  config-as-code `cronSchedule` has sometimes not been applied. With a schedule
  set, a deploy does not start a run; the schedule (or _Run now_) does.
- Variables: [`railway/.env.curator.example`](railway/.env.curator.example).
  `CURATOR_DRY_RUN=true` until you've checked a scheduled dry run's log.
- Partner sign-in: run `pnpm --filter @oracle-markets/curator login` locally, then
  set `PARTNER_MCP_AUTH_JSON` to the base64 of `~/.config/oracle-markets/partner-mcp-auth.json`.
  The first run copies it to Redis (`curator:partner-auth`), which keeps the
  rotating tokens from then on. To re-seed, delete that key and set the variable again.
- `CURATOR_KEYPAIR` (base64 of the solana-keygen file) is the authority, so the
  resolver, of every curated market. Resolve them in `/admin` with that wallet;
  the curator never resolves.
- **Run now** from `/admin` (admin wallets: `NEXT_PUBLIC_CATEGORY_ADMINS`, featured
  authorities, or server-only `CURATOR_ADMINS` on `app`): the web stores
  `curator:run-request`, and the keeper calls Railway's `deploymentInstanceExecutionCreate`.
  The keeper needs `CURATOR_TRIGGER_TOKEN` (a _project_ token for this project)
  and `CURATOR_SERVICE_ID`. Locally: `pnpm --filter @oracle-markets/curator once`.
  _Dry-run preview_ does the same for one run with nothing sent, whatever
  `CURATOR_DRY_RUN` says (the keeper sets `curator:next-run-dry`).
- Reports: every run (live, dry, preview, failed) is saved to `curator:runs:<ms>`
  (last 30) and listed in `/admin` under _Recent curator runs_. Curated markets
  still in their category's top N appear on `/markets?category=oracle`
  ("From the Oracle").
- `CURATOR_ANNOUNCE_ON_X=true` (curator) queues one summary post per live run
  that created markets; the xbot posts it (`curator:announcements`).

### Build-time vs runtime variables

`NEXT_PUBLIC_*` values are compiled into the browser bundle. The root
`Dockerfile` declares each one as an `ARG`, and Railway passes service variables
as build args, so **changing a `NEXT_PUBLIC_*` value requires a redeploy**; a
restart is not enough. Every such value is public. The Dockerfile deliberately
declares no `ARG` for the local dev-wallet variable read by
`app/src/providers/local-wallet-adapter.ts`, so that key can never reach a
Railway bundle. Keep it out of Railway variables anyway.

Server-only secrets (`MINT_AUTHORITY_KEY`, `KEEPER_SHARED_SECRET`,
`KEEPER_KEYPAIR`, `REDIS_URL`) are read at runtime.

## Variables

### `web`

| Variable                                                              | Devnet                                                              | Mainnet                          | Notes                                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SOLANA_CLUSTER`                                          | `devnet`                                                            | `mainnet-beta`                   | build-time                                                                        |
| `NEXT_PUBLIC_PROGRAM_ID`                                              | `GV1F…N16y`                                                         | `GV1F…N16y`                      | build-time; same ID on both                                                       |
| `NEXT_PUBLIC_USDC_MINT`                                               | `3WQ8…MEWZ` (mock)                                                  | `EPjF…Dt1v` (Circle)             | build-time                                                                        |
| `NEXT_PUBLIC_RPC_URL`                                                 | public devnet or provider                                           | **dedicated provider**           | build-time; visible to browsers, so restrict by domain                            |
| `NEXT_PUBLIC_SITE_URL`                                                | `https://${{RAILWAY_PUBLIC_DOMAIN}}`                                | your custom domain               | build-time; metadata, OG, canonical URLs                                          |
| `NEXT_PUBLIC_X_HANDLE`                                                | optional                                                            | optional                         | build-time; Twitter card                                                          |
| `NEXT_PUBLIC_FEATURED_AUTHORITIES`                                    | optional                                                            | recommended                      | build-time; comma-separated pubkeys                                               |
| `REDIS_URL`                                                           | `${{Redis.REDIS_URL}}`                                              | `${{Redis.REDIS_URL}}`           | runtime                                                                           |
| `SERVER_RPC_URL`                                                      | provider or empty                                                   | **dedicated provider**           | runtime; server reads for share cards / metadata / Blinks, never sent to browsers |
| `ACTIONS_MAX_USDC` / `ACTIONS_SLIPPAGE_BPS` / `ACTIONS_FEATURED_ONLY` | `250` / `200` / `false`                                             | same / same / `true` recommended | runtime; Blinks, see [BLINKS.md](BLINKS.md)                                       |
| `KEEPER_SHARED_SECRET`                                                | `openssl rand -hex 32`                                              | `openssl rand -hex 32`           | runtime; guards `POST /api/price-snap`                                            |
| `NEXT_PUBLIC_FAUCET_URL`                                              | empty (own faucet) or `https://pm-amm-devnet.vercel.app/api/faucet` | n/a                              | build-time; the browser calls it directly so per-IP limits apply per visitor      |
| `MINT_AUTHORITY_KEY`                                                  | base64 mint key (`EftrgEw3…`)                                       | **never set**                    | runtime; faucet only, see [DEVNET.md](DEVNET.md)                                  |
| `FAUCET_*`                                                            | optional                                                            | n/a                              | runtime; see [DEVNET.md](DEVNET.md)                                               |

### `keeper`

| Variable                        | Devnet                    | Mainnet                | Notes                                                                     |
| ------------------------------- | ------------------------- | ---------------------- | ------------------------------------------------------------------------- |
| `REDIS_URL`                     | `${{Redis.REDIS_URL}}`    | `${{Redis.REDIS_URL}}` | required                                                                  |
| `KEEPER_RPC_URL`                | provider or public devnet | **dedicated provider** | server key, separate from the browser's; must allow `getProgramAccounts`  |
| `PROGRAM_ID`                    | `GV1F…N16y`               | `GV1F…N16y`            |                                                                           |
| `USDC_MINT`                     | `3WQ8…MEWZ`               | `EPjF…Dt1v`            |                                                                           |
| `KEEPER_INTERVAL_SECS`          | `20`                      | `20`                   |                                                                           |
| `KEEPER_ACCRUE_ENABLED`         | `false`                   | `false` / `true`       | accrue runs only if this is `true` **and** `KEEPER_KEYPAIR` is set        |
| `KEEPER_KEYPAIR`                | —                         | fresh hot wallet       | base64 64-byte secret; **no authority over anything**; fund with ~0.1 SOL |
| `KEEPER_ACCRUE_EVERY_SECS`      | `3600`                    | `3600`                 |                                                                           |
| `KEEPER_PRIORITY_MICROLAMPORTS` | `5000`                    | `5000`                 |                                                                           |
| `KEEPER_MIN_SOL`                | `0.05`                    | `0.05`                 | accrue stops below this balance                                           |

`accrue` is permissionless and only rebases LP residuals, so the keeper wallet
can lose at most its own SOL in fees.

### Curated list

When `NEXT_PUBLIC_FEATURED_AUTHORITIES` is set, `/markets` and the
commitment-vault strip show only rows created by those keys. An _All markets_
toggle shows everything, with a "community" badge on non-featured rows.
Markets launched from a featured creator's binary vault count as featured.
Bet Vault markets are owned by the vault PDA, so to feature one, add that PDA to
the list. The landing page (`/`) is static and lists no markets.

## Smoke test (after every deploy)

- [ ] `curl https://<domain>/api/health` returns `{"ok":true,"cluster":"…","programId":"GV1F…","redis":"tcp"}`
- [ ] Keeper logs show a JSON `"msg":"tick"` line every ~20 s with non-null `markets` / `groups` / `vaults` counts
- [ ] `curl https://<domain>/api/markets` returns 200 with `updatedAt` less than 60 s old
- [ ] `curl -X POST https://<domain>/api/price-snap -H 'content-type: application/json' -d '{}'` returns **401**
- [ ] `/`, `/markets`, `/docs` load; the header shows the `oracle/markets` wordmark and the tab title reads "Oracle Markets"
- [ ] A market page shows its chart (keeper points) and a "Resolved by" row
- [ ] Devnet only: the faucet button funds a fresh wallet. Mainnet: the faucet is hidden and `POST /api/faucet` returns 503
- [ ] Make a small trade; the new price shows immediately (direct RPC refresh), and a chart point appears within one keeper interval
- [ ] With featured authorities set: the _Featured / All markets_ toggle works, and the community badge appears only in _All_

## Local run (same images)

```bash
docker compose up --build        # web on :8080, keeper, redis:7 — devnet
curl localhost:8080/api/health
```

Without Docker:

```bash
pnpm install
pnpm run build:keeper
REDIS_URL=redis://localhost:6379 node workers/keeper/dist/index.js   # or: pnpm keeper
REDIS_URL=redis://localhost:6379 pnpm run dev
```

## Out of scope here

Running your own program instance (own program ID, own fee DAO, own upgrade
authority) is a separate project. See [MAINNET.md](MAINNET.md). Nothing in
this deployment changes `anchor/`, `declare_id!`, or `PROTOCOL_DAO`.
