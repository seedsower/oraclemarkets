# Coding prompt — "Curator": auto-create Oracle Markets from the top 10 oraclemarkets.io questions per category

Paste everything below the line into Claude Code at the root of the oraclemarkets.app repo (the sparkfun-labs/pm-amm fork with `app/`, `packages/sdk`, `workers/keeper`, `workers/xbot`, Redis, deployed on Railway).

---

## Goal

Every 3 days, a scheduled job reads our partner oraclemarkets.io's AI forecasts over MCP, picks the **top 10 eligible questions in each category**, and creates an on-chain pm-AMM market for every one we don't already have: opened at the AI consensus price, seeded with a small, fixed amount of liquidity, and linked back to the partner question. It must be idempotent, budget-capped, dry-run by default, and never resolve anything on its own.

First, read the codebase and report where these already live (if they exist): a `partner-feed` MCP client module, the `ai:*` Redis keys, the admin resolution queue, market creation in the SDK/app (`initialize_market` + `deposit_liquidity`), market-id allocation, and the featured/curated market filter. Reuse them; do not build parallel copies. Commit after each phase; keep `pnpm type-check`, `pnpm lint` and tests green.

## Verified facts (do not re-derive)

- Partner access is **MCP only** (no REST API). Known tools: `search_predictions`, `get_prediction`; others may exist. Their `/connect` page holds the endpoint and auth details; the human will put them in env vars `PARTNER_MCP_URL` and `PARTNER_MCP_TOKEN` (or tell you it's OAuth).
- The partner's predictions page lists **12 categories**: Politics, Finance, Economics, Geopolitics, Culture, Business, Sports, Climate, Technology, Science, Crypto, Other. It shows no sort order and no probabilities in the list view, so "top" is not defined by the partner's UI.
- Partner forecasts update **daily**.
- Contract limits for a plain market (`initialize_market`): `end_ts` from now+5 min to ~50 years; `initial_price_bps` 100–9900; name is a fixed 64-byte UTF-8 field. Liquidity is added separately via `deposit_liquidity`. `market.authority` (resolver + creator-fee recipient) is the signer that creates the market. Confirm these against the code you have, since the program may have been redeployed with new constants.
- A recent analysis found: opening at 50% on near-decided questions and over-seeding liquidity make the liquidity provider (us) lose heavily to informed one-sided flow. Hence: open at the AI consensus, keep seed liquidity small, and skip near-certain questions.

## Phase 0 — MCP discovery (stop and report before Phase 1)

If no `partner-feed` module exists yet, create `workers/shared/partner-feed` (or the repo's equivalent) using `@modelcontextprotocol/sdk` (`Client` + `StreamableHTTPClientTransport`, falling back to `SSEClientTransport`). Then write `scripts/partner-mcp-discover.ts` that:

1. Runs `tools/list` and prints every tool's name, description, `inputSchema`, `outputSchema`.
2. For each of the 12 categories, tries to list active questions (try a category argument, an empty/wildcard query, paging cursors, and any `sort`/`order`/`limit` arguments the schemas expose). Save raw responses to `scripts/partner-mcp-samples/`.
3. Calls `get_prediction` on two results per category.

Report, then **stop and wait for confirmation**:
- Whether output is structured JSON (`structuredContent` or a JSON text block) or prose. Prose-only is a blocker; ask the partner for JSON.
- Whether any tool returns questions **per category** and whether it exposes a **ranking** (e.g. popularity, featured, volume, trending). Quote the parameter names.
- Which fields exist per question: id, title, resolution criteria, close date, category, status, consensus probability, per-agent probabilities, Polymarket/Kalshi odds or links, updated_at, URL.
- Rate limits or auth errors observed.

## Phase 1 — Ranking and eligibility (pure functions, fully unit-tested)

Create `workers/curator/src/select.ts` exporting `selectTop(questions, config) → { selected, skipped: {id, reason}[] }` per category.

**Eligibility filters** (all env-configurable, defaults shown); a question is skipped with a reason if it fails any:
- `status` is active; resolution criteria present and non-empty.
- Close date between `CURATOR_MIN_DAYS=3` and `CURATOR_MAX_DAYS=120` days from now.
- Forecast fresh (`updated_at` < 48h old).
- Consensus probability between `CURATOR_MIN_PROB=0.05` and `CURATOR_MAX_PROB=0.95` (skip near-certain questions).
- A display title can be produced that fits **64 bytes UTF-8** (see Phase 2). Never cut mid-character.
- Content policy (deterministic keyword screen + a Claude Haiku classification call returning strict JSON): exclude questions about private individuals, deaths, violence or self-harm, minors, or outcomes a market participant could decide. Log the model's reason.
- Category is in `CURATOR_CATEGORIES` (default: all 12; comma-separated override).

**Ranking**, in this order of preference:
1. If Phase 0 found a partner-provided ranking per category, use it as the primary order.
2. Otherwise compute `score = w_venue·hasPolymarketOrKalshiMatch + w_uncertain·(1 − |2p − 1|) + w_soon·closesWithin30Days + w_fresh·updatedInLast24h`, with weights from env (defaults 0.4 / 0.3 / 0.2 / 0.1). Ties broken by sooner close date, then partner id.
3. Take the first `CURATOR_TOP_N=10` eligible questions per category.

Tests: each filter, the 64-byte boundary (including multibyte characters), score ordering, ties, fewer than 10 eligible in a category.

## Phase 2 — Market creation

`workers/curator/src/create.ts`, for each selected question with no existing link:

1. **Idempotency**: check Redis `ai:link:question:<questionId>`. If linked, skip; never create a second market for the same question. Write the link immediately after the creation transaction confirms, and reconcile on startup (scan our program's markets for names/metadata matching pending creations, so a crash between confirm and Redis write can't duplicate).
2. **Title**: produce a ≤64-byte on-chain name: use the partner title if it fits; otherwise ask Claude (Haiku, strict JSON) for a shortened neutral version, then verify byte length and that it still names the same event. The full title, resolution criteria, partner URL, category and partner id go into our metadata store (Redis `market:meta:<pubkey>` or the existing store), shown on the market page with attribution: "Question and AI line by oraclemarkets.io".
3. **Deadline**: `end_ts = partner_close − CURATOR_CLOSE_BUFFER_HOURS` (default 24), so trading stops before the outcome is typically known. Must satisfy the contract's min duration.
4. **Opening price**: `initial_price_bps = clamp(round(consensus × 10000), 500, 9500)`.
5. **Seed liquidity**: `CURATOR_SEED_USDC` (default 50) via `deposit_liquidity` in the same or an immediately following transaction. If seeding fails, record the market as `unseeded` and retry next run; do not create another market.
6. **Market id**: use the repo's existing allocation scheme; if none, derive a collision-checked id and retry on `AccountAlreadyInUse`.
7. **Signer**: a dedicated curator keypair (`CURATOR_KEYPAIR`, base64), separate from the keeper, bot and faucet keys. Note in docs that this key becomes `market.authority` for every curated market, so it is also their resolver and creator-fee recipient. Keep its balance small and top it up. Do not add any auto-resolve path.
8. Set the existing "featured/curated" flag (from the curated-markets feature) and a `source=oraclemarkets.io` tag so the app can list "From the Oracle" by category.

## Phase 3 — Budgets and safety rails

All checked **before** any transaction; on violation, stop creating, finish the report, exit 0:
- `CURATOR_DRY_RUN=true` by default: do everything except send transactions; log the exact markets that would be created.
- `CURATOR_MAX_NEW_PER_RUN=40`.
- `CURATOR_MAX_OPEN_SEED_USDC` (default 3000): sum of seed in currently unresolved curated markets plus this run's new seeds must stay below it.
- `CURATOR_MIN_SOL` (default 0.5) and enough USDC for all planned seeds; otherwise create only what's affordable, highest score first, round-robin across categories so one category can't consume the whole budget.
- Global Redis lock `curator:lock` with a 2-hour TTL, so two runs never overlap.
- Exponential backoff and a per-run cap on MCP calls (`CURATOR_MAX_MCP_CALLS=500`); respect `PARTNER_MCP_MIN_INTERVAL_MS`.
- Cluster guard: refuse to run against mainnet unless `CURATOR_ALLOW_MAINNET=true`.

## Phase 4 — Lifecycle of existing curated markets

Markets can't be deleted on-chain, so:
- Questions that fall out of the top 10 keep their market; just clear the `featured` flag (the app still lists them under "All markets").
- Questions the partner marks `resolved` or `void`: push a proposal into the existing admin resolution queue ("Partner resolved YES on <date>, source: <url>"). For `void`, flag it for human review. Never call `resolve_market` from the curator.
- Refresh the AI line for every linked question each run (reusing the feed integration's sync if it exists).

## Phase 5 — Scheduling on Railway

1. New service `curator` built from `workers/curator/Dockerfile` with config `/railway/curator.json`:
   ```json
   {
     "$schema": "https://railway.com/railway.schema.json",
     "build": { "builder": "DOCKERFILE", "dockerfilePath": "workers/curator/Dockerfile",
                "watchPatterns": ["workers/curator/**", "workers/shared/**", "packages/sdk/**"] },
     "deploy": { "cronSchedule": "0 14 */3 * *", "restartPolicyType": "NEVER" }
   }
   ```
   Railway cron times are UTC (14:00 UTC = 7:00 a.m. Mountain in winter). `*/3` restarts at the start of each month, so occasionally two runs are 1–2 days apart; that's acceptable.
2. The process must run once and **exit** (Railway cron requires the process to terminate; a still-running job causes the next run to be skipped). Close the MCP client, the Redis connection and RPC sockets, then `process.exit(0)` on success and a non-zero code on a fatal error.
3. In `RAILWAY.md`, note that `cronSchedule` from config-as-code has occasionally not been applied; verify the schedule in the service's Settings after the first deploy.
4. Add a manual trigger: `pnpm --filter curator run once` locally, and an admin-only `POST /api/admin/curator/run` that enqueues a run flag the keeper checks (don't run the curator inside the web process).

## Phase 6 — Reporting

At the end of each run, write `curator:runs:<timestamp>` to Redis (keep the last 30) with: per category, the selected questions, created markets (pubkey, price, seed, tx signature), skips with reasons, budget used, errors. Add an admin page tab "Curator" that shows the latest runs and a "dry-run preview" button. Optionally (off by default, `CURATOR_ANNOUNCE_ON_X=false`) have the xbot post one summary post per run linking `/markets?source=oracle`.

## Tests and acceptance

- Unit: Phase 1 functions; title byte-length; price clamp; deadline buffer; budget allocation round-robin; idempotency (a second run with the same partner data creates zero markets).
- Integration on devnet with `CURATOR_DRY_RUN=true`: report lists ≤10 per category with reasons for skips. Then with dry run off and `CURATOR_MAX_NEW_PER_RUN=3`: three markets created, opened at the clamped AI price, seeded, linked, visible on the site under their category with attribution.
- A fake MCP server fixture (built from Phase 0 samples) for CI.

## Out of scope

- Any change to the Solana program.
- Automatic on-chain resolution.
- Creating markets from any source other than the partner's MCP.
