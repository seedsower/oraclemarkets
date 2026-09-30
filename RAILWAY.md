# Deploying Oracle Markets on Railway

Railway is now the primary host for the Oracle Markets front end. The Vercel
files (`app/vercel.json`, `.vercelignore`) are still in the repo and still work,
but new deployments should follow this guide.

The on-chain program is **not** deployed from here. Oracle Markets runs against
the existing pm-AMM program (`GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y`, the
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

1. **Create the project.** In Railway, choose *New Project → Deploy from GitHub
   repo* and pick your fork. Rename the service it creates to `web`.
2. **Point `web` at its config.** Go to *web → Settings*, set *Config-as-code /
   Railway Config File* to `/railway/web.json`, and leave *Root Directory*
   empty. The config file path is absolute from the repo root, and Railway does
   not resolve it relative to the Root Directory. The config selects the root
   `Dockerfile`, the `/api/health` healthcheck, and watch patterns so that
   anchor-only commits don't trigger a redeploy.
3. **Add Redis.** Choose *+ New → Database → Redis*. Keep the service name
   `Redis`, so the `${{Redis.REDIS_URL}}` references below resolve.
4. **Add the keeper.** Choose *+ New → GitHub Repo*, pick the same fork, rename
   the service to `keeper`, and set its config file to `/railway/keeper.json`.
   Don't give it a domain; it serves no HTTP.
5. **Variables.** Paste a template into each service's *Variables → Raw Editor*
   and fill in the blanks:
   - `web`: [`railway/.env.web.devnet.example`](railway/.env.web.devnet.example)
     or [`railway/.env.web.mainnet.example`](railway/.env.web.mainnet.example)
   - `keeper`: [`railway/.env.keeper.example`](railway/.env.keeper.example)

   Railway resolves `REDIS_URL=${{Redis.REDIS_URL}}` to Redis's private URL
   (`*.railway.internal`, reachable over IPv6; both Redis clients set `family: 0`).
6. **Domain.** Go to *web → Settings → Networking → Generate Domain*. Once a
   custom domain is attached (*+ Custom Domain*, then add the CNAME record Railway
   shows at your DNS provider), set `NEXT_PUBLIC_SITE_URL` to it and **redeploy**.
7. Deploy both services. Railway builds the root `Dockerfile` for `web` and
   `workers/keeper/Dockerfile` for `keeper`.

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

| Variable | Devnet | Mainnet | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SOLANA_CLUSTER` | `devnet` | `mainnet-beta` | build-time |
| `NEXT_PUBLIC_PROGRAM_ID` | `GV1F…N16y` | `GV1F…N16y` | build-time; same ID on both |
| `NEXT_PUBLIC_USDC_MINT` | `3WQ8…MEWZ` (mock) | `EPjF…Dt1v` (Circle) | build-time |
| `NEXT_PUBLIC_RPC_URL` | public devnet or provider | **dedicated provider** | build-time; visible to browsers, so restrict by domain |
| `NEXT_PUBLIC_SITE_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` | your custom domain | build-time; metadata, OG, canonical URLs |
| `NEXT_PUBLIC_X_HANDLE` | optional | optional | build-time; Twitter card |
| `NEXT_PUBLIC_FEATURED_AUTHORITIES` | optional | recommended | build-time; comma-separated pubkeys |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | `${{Redis.REDIS_URL}}` | runtime |
| `KEEPER_SHARED_SECRET` | `openssl rand -hex 32` | `openssl rand -hex 32` | runtime; guards `POST /api/price-snap` |
| `MINT_AUTHORITY_KEY` | base64 mint key (`EftrgEw3…`) | **never set** | runtime; faucet only, see [DEVNET.md](DEVNET.md) |
| `FAUCET_*` | optional | n/a | runtime; see [DEVNET.md](DEVNET.md) |

### `keeper`

| Variable | Devnet | Mainnet | Notes |
|---|---|---|---|
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | `${{Redis.REDIS_URL}}` | required |
| `KEEPER_RPC_URL` | provider or public devnet | **dedicated provider** | server key, separate from the browser's; must allow `getProgramAccounts` |
| `PROGRAM_ID` | `GV1F…N16y` | `GV1F…N16y` | |
| `USDC_MINT` | `3WQ8…MEWZ` | `EPjF…Dt1v` | |
| `KEEPER_INTERVAL_SECS` | `20` | `20` | |
| `KEEPER_ACCRUE_ENABLED` | `false` | `false` / `true` | accrue runs only if this is `true` **and** `KEEPER_KEYPAIR` is set |
| `KEEPER_KEYPAIR` | — | fresh hot wallet | base64 64-byte secret; **no authority over anything**; fund with ~0.1 SOL |
| `KEEPER_ACCRUE_EVERY_SECS` | `3600` | `3600` | |
| `KEEPER_PRIORITY_MICROLAMPORTS` | `5000` | `5000` | |
| `KEEPER_MIN_SOL` | `0.05` | `0.05` | accrue stops below this balance |

`accrue` is permissionless and only rebases LP residuals, so the keeper wallet
can lose at most its own SOL in fees.

### Curated list

When `NEXT_PUBLIC_FEATURED_AUTHORITIES` is set, `/markets` and the
commitment-vault strip show only rows created by those keys. An *All markets*
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
- [ ] With featured authorities set: the *Featured / All markets* toggle works, and the community badge appears only in *All*

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
