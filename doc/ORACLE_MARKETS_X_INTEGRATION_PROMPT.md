# Coding prompt — Oracle Markets on X (share cards, Blinks, mention bot)

Paste everything below the line into Claude Code at the root of the Oracle Markets fork, after the Railway prompt has been completed (it assumes `web`, `redis`, `keeper` services, `lib/brand.ts`, and the `/api/markets` cache exist).

---

## Goal

Let people predict on Oracle Markets without leaving X, non-custodially. Every trade is signed by the user's own wallet; our servers never hold user funds or keys. Ship in three phases, each independently useful. Commit after each phase; keep `pnpm type-check`, `pnpm lint`, and existing tests green.

## Verified repo facts

- Market pages live at `app/src/app/market/[id]/page.tsx`; `[id]` is the numeric `marketId` (the u64 used in the PDA seed `["market", id_le_u64]`), not the PDA.
- `@pm-amm/sdk` builds instructions without sending: `client.ix.swap({ signer, market, direction, amountIn, minOutput, creatorAuthority, collateralMint })`. Directions include USDC→YES and USDC→NO (see `packages/sdk/src/types/args.ts` for exact names).
- `client.send.swap` in `packages/sdk/src/send.ts` shows the required pre-instructions: compute budget `CU.HEAVY`; idempotent ATAs for YES mint, NO mint and collateral; the protocol DAO's collateral ATA (off-curve allowed); the creator's collateral ATA when signer ≠ `market.authority` (off-curve allowed, since bet-vault authorities are PDAs). Reuse `ensureAtaIx` / `computeBudgetIx` from `packages/sdk/src/util/ata.ts`. Do not duplicate this logic — extract a pure `buildSwapTx(connection, client, { signer, market, direction, amountUsdc, slippageBps })` helper into the SDK (e.g. `packages/sdk/src/flows/swapTx.ts`) that returns instructions, and make `send.swap` use it too.
- Swap quoting math exists in `packages/sdk/src/math.ts` (used by `app/src/hooks/use-swap-quote.ts`); use it to compute `minOutput` with slippage.
- The web app's `opengraph-image.tsx` exists only at the root; there are no per-market OG images yet.

## Phase 1 — Live share cards (every X user sees these)

1. Add `app/src/app/market/[id]/opengraph-image.tsx` (1200×630) and `twitter-image.tsx` (re-export). Render: market question, big YES price in cents, NO price, 24h change if price history has ≥2 points, time remaining or "Resolved: YES/NO", total liquidity, Oracle Markets wordmark. Read data from the Redis `cache:markets` snapshot first; fall back to one direct `fetchMarket` RPC call. Cache with `revalidate = 60`.
2. Add `generateMetadata` on the market page: title = market question, description = "YES 34¢ · NO 66¢ · closes in 3d", `twitter: { card: "summary_large_image", site: BRAND.xHandle }`.
3. Add a "Share on X" button on the market page and trade confirmation toast that opens `https://x.com/intent/post?text=…&url=…` with prefilled copy ("I'm buying YES at 34¢ on: <question>"). Post-trade copy includes side and price only, never wallet address or amount unless the user toggles "show amount".
4. Same treatment for group markets (`/group/[id]`): OG image shows top 4 legs with prices.

## Phase 2 — Solana Actions / Blinks (trade inside the X timeline)

Implement the Solana Actions spec so that an ordinary market URL posted on X unfurls into YES/NO buttons for users with a Blink-capable wallet extension (Phantom, Solflare, Backpack), and falls back to the Phase 1 card for everyone else.

1. Add dependency `@solana/actions` to `app` and use its helpers (`ACTIONS_CORS_HEADERS`, `createPostResponse`, `BLOCKCHAIN_IDS`) rather than hand-rolling the response shapes. Verify current exports against the installed version before using them.
2. `app/src/app/actions.json/route.ts` → serves `{ "rules": [ { "pathPattern": "/market/*", "apiPath": "/api/actions/market/*" }, { "pathPattern": "/group/*", "apiPath": "/api/actions/group/*" } ] }` with Actions CORS headers. It must be served from the domain root.
3. `app/src/app/api/actions/market/[id]/route.ts`:
   - `OPTIONS`: CORS preflight with Actions headers.
   - `GET`: return an `ActionGetResponse`: `icon` = absolute URL of the Phase 1 OG image, `title` = question, `description` = current prices + close time + one line "Resolved by the market creator (<short address>)", `label` = "Predict". `links.actions`: "YES $5", "YES $25", "NO $5", "NO $25", and one parameterized action per side with an `amount` input (min 1, max `ACTIONS_MAX_USDC`, default 250). If the market is resolved, expired, or not in the featured allowlist when `ACTIONS_FEATURED_ONLY=true`, return `disabled: true` with an explanatory `error.message`.
   - `POST ?side=yes|no&amount=N` with body `{ account }`: validate `account` as a base58 on-curve pubkey, validate `side`/`amount`, rate limit per account and per IP with the existing `rateLimit` helper, quote with the SDK math, build the swap instructions via the new `buildSwapTx` helper with `ACTIONS_SLIPPAGE_BPS` (default 200), set `feePayer = account` and a fresh blockhash, serialize **unsigned** as base64 (versioned or legacy — match what the wallet adapters in the app already accept), and return via `createPostResponse` with `message` = "Buying ~N YES at ≈P¢. 2% fee included." Include `links.next` pointing to a completed-action response ("You're in. Share your prediction →" with the market URL).
   - All responses include the `X-Action-Version` and `X-Blockchain-Ids` headers; the blockchain id comes from `NEXT_PUBLIC_SOLANA_CLUSTER` (mainnet vs devnet).
   - Before building, check the user's collateral balance; if it is insufficient, return a 400 with a clear message ("You need 25 USDC in this wallet") instead of a transaction that will fail.
4. `app/src/app/api/actions/group/[id]/route.ts`: GET lists up to 6 legs as buttons ("<Leg> YES $10"); POST `?leg=<index>&amount=N` routes to the leg's binary market swap. Reuse the same code path.
5. Build the SDK client server-side with a read-only provider (a dummy wallet that throws on sign) using `KEEPER_RPC_URL`/a server RPC env var, never `NEXT_PUBLIC_RPC_URL`.
6. Tests: unit-test GET shape and POST validation; an integration script `scripts/e2e-blink-devnet.cjs` that calls GET, POSTs with a devnet keypair, signs the returned transaction locally, sends it, and asserts YES balance increased.
7. `BLINKS.md`: how to test with the Blinks inspector/dial.to on devnet, how to enable Blinks in the Phantom extension, and the steps to submit the domain to the Dialect Actions registry (look up the current registration process and link it; do not invent it). Note clearly that unfurling on X only works for desktop users with an extension and a registered domain; mobile users get the Phase 1 card and tap through to the site.
8. Security: never return a transaction that transfers anything other than the swap and fee accounts the program itself dictates. Add a unit test that decodes the returned transaction and asserts the program IDs are limited to ComputeBudget, Associated Token, Token, and the pm-AMM program.

## Phase 3 — `@OracleMarkets` mention bot (new Railway service `xbot`)

A worker that reacts to mentions and replies with Blink links. It never trades on anyone's behalf.

1. New workspace package `workers/xbot` + `workers/xbot/Dockerfile` + `/railway/xbot.json` (restart `ALWAYS`). Uses the official X API v2 with OAuth 2.0 user context for the bot account. Env: `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REFRESH_TOKEN`, `X_BOT_USER_ID`, `XBOT_POLL_SECS` (default 60), `XBOT_DAILY_REPLY_CAP` (default 100), `XBOT_DRY_RUN` (default true). Persist rotated refresh tokens and the `since_id` cursor in Redis (access tokens expire every ~2 hours).
2. Poll `GET /2/users/:id/mentions` with `since_id` (cheap "owned read" pricing). Parse commands deterministically (no LLM required for v1):
   - `odds <id or search words>` → reply with the market URL (which unfurls as a Blink) + one-line prices.
   - `markets` / `trending` → reply with the top 3 featured markets by 24h volume, one URL each is too costly, so link a single `/markets?ref=x` page instead.
   - `propose <question> by <date>` → store the proposal in Redis (`proposals:*`) with the proposer's handle, reply "Noted — if we list it, we'll tag you." Do NOT auto-create markets; creation is an admin action in the web `/admin` page, which gets a new "Proposals from X" tab showing them with an "Create market" button that pre-fills `/create`.
   - Anything else → no reply (avoid spam).
3. Cost and abuse controls: dedupe by tweet id; one reply per user per 10 minutes; honor `XBOT_DAILY_REPLY_CAP`; log X API credit usage estimates per day (replies with a URL are the expensive call). Check the current X API rules on automated replies before enabling; the bot must only reply to posts that mention it.
4. Optional "Sign in with X" (only if cheap to add): link an X handle to a wallet by signing a message in-app (`/connect-x`), store `x:<handle> → wallet` in Redis, and show handle badges on a public leaderboard of realized P&L. Opt-in only, with an unlink button.

## Out of scope

- Custodial betting via tweets (e.g. "@OracleMarkets bet 10 YES") — requires holding user funds and keys. Do not build.
- Any change under `anchor/`.
- LLM-generated replies or automatic market creation.

## Acceptance criteria

- Posting a market URL in a devnet test: Blinks inspector renders buttons; signing a $5 YES buy succeeds and the position shows in the app.
- Market URLs render a large image card in X's card preview for users without extensions.
- `xbot` in `XBOT_DRY_RUN=true` logs the replies it would send for a scripted set of mentions and sends none.
