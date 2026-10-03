# xbot: the Oracle Markets mention bot

A Railway worker that answers people who **@mention the bot account** on X
with market links. Those links unfurl as share cards and, for wallets with
Blinks enabled, as YES/NO buttons. The bot **never trades**, holds no wallet,
and never creates markets.

## Commands

Commands are parsed by fixed rules, with no AI. Typos and synonyms work
(`odd`, `price`, `chance` → odds; `market`, `top`, `hot` → markets; `suggest`,
`idea` → propose), and so do **plain questions**:

- "sol price today" → the best-matching **live** market (closed-but-unresolved markets are skipped)
- "will btc reach 100k by december" with no matching market → saved as a proposal ("Noted…")
- "will sol flip btc in volume" (no date, no market) → a hint on how to `propose`
- small talk ("gm", "thanks", "love this") → no reply

Odds replies for tradable markets end with **one-tap buy links**
(`/market/<id>?buy=yes&amount=5` and `…?buy=no…`). They open the market with
the trade panel pre-filled. On a phone without a wallet in the browser, the
page offers "Open in Phantom / Solflare", which reopens it inside the wallet
app, already connected. The user still reviews and signs. Live markets are
always preferred over resolved ones.

| Post | Reply |
|---|---|
| `@bot odds <market id or words>` | Question, `YES 34¢ · NO 66¢ · closes in 3d`, and the market link. Groups show the top 3 outcomes. No match gets a link to the market list. |
| `@bot markets` / `@bot trending` | Top 3 live featured markets with YES prices, plus one link to `/markets?ref=x` |
| `@bot propose <question> by <date>` | "Noted — if we list it, we'll tag you." The proposal is stored and shown in `/admin` → **Proposals from X**. Listing it is your decision. |
| `@bot bet? by <date>` (as a reply to a take) or `@bot bet <question> by <date>` | Opens a **Bet Vault** on the take: 1h to stake YES/NO (or choose: `… in 30m`, `… in 1d`; 15m–7d) (the pot sets the odds), then the bot launches a market anyone can trade until the deadline. You resolve it in `/admin`. Winners split the pot; unfilled or unresolved bets refund everyone. |

"Trending" is ranked by pool depth, because the keeper doesn't track 24h volume yet.

## Guardrails

- Replies **only** to posts that mention the bot (the mentions timeline), never
  to its own posts or retweets, at most once per post (deduplicated by post id).
- One reply per person per 10 minutes, and at most `XBOT_DAILY_REPLY_CAP` replies a day (default 100).
- **`XBOT_DRY_RUN=true` by default**: it logs `DRY RUN — would reply` with the
  exact text and sends nothing.
- On its first run it starts from the newest mention instead of answering the backlog.
- Daily API usage (posts read, posts sent, posts with a URL) is logged, with a USD
  estimate if you set `XBOT_COST_*` from your X plan's pricing.
- Rate limits: on HTTP 429 it waits until X's reset time.

### X's rules (checked 2026-10-01)

X's automation rules allow an automated account to reply when the post's author
mentions it, one reply per interaction. Bot accounts should carry X's
**Automated** label (Settings → Your account → Account information →
Automation). AI-generated reply bots need prior written approval from X; this bot
is rule-based. Re-check the current rules before setting `XBOT_DRY_RUN=false`:
<https://help.x.com/en/rules-and-policies/x-automation>.

## Setup

There are two ways to connect the bot account. **Option A is simpler.**

### Option A: OAuth 1.0a keys (no browser step)

The bot posts as the account that **owns the developer app**.

1. In the developer portal, open your app and set *User authentication settings* → permissions to **Read and write**.
2. Under **Keys and tokens**, copy the **API Key and Secret**, then
   **generate the Access Token and Secret**. Generate them *after* step 1, because
   tokens keep the permissions they were created with.
3. Check them locally. This only reads, nothing is posted:
   ```bash
   cd workers/xbot
   X_API_KEY=… X_API_SECRET=… X_ACCESS_TOKEN=… X_ACCESS_SECRET=… npx tsx src/check.ts
   ```
4. Put the same four values on the Railway `xbot` service, keeping
   `XBOT_DRY_RUN=true`. `X_BOT_USER_ID` is optional; it's looked up automatically.

### Option B: OAuth 2.0 (any account)


1. **X app settings** (developer portal → your app → *User authentication
   settings*): permissions **Read and write**, type **Web App, Automated App or
   Bot**, callback URI `http://127.0.0.1:3333/callback`, and website
   `https://oraclemarkets.app`.
2. **Authorize the bot account.** Log into **@daotao23** on x.com, then run on your machine:
   ```bash
   X_CLIENT_ID=… X_CLIENT_SECRET=… pnpm --filter @oracle-markets/xbot auth
   ```
   Open the printed link and approve. The terminal prints `X_BOT_USER_ID` and
   `X_REFRESH_TOKEN`. If the browser then says `127.0.0.1` can't be reached
   (common when the terminal is on another machine, e.g. VS Code Remote), copy
   the full URL from the address bar, paste it into the terminal and press Enter.
   Do it quickly: the code expires in about 30 seconds.
3. **Railway `xbot` service variables** (template:
   [`railway/.env.xbot.example`](../../railway/.env.xbot.example)): `REDIS_URL`,
   `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_BOT_USER_ID`, `X_REFRESH_TOKEN`, and keep
   `XBOT_DRY_RUN=true`.
4. Watch the logs while people mention the bot. When the `DRY RUN — would
   reply` lines look right, set `XBOT_DRY_RUN=false`.

The refresh token **rotates** on every use. The bot saves each new one to Redis
(`xbot:refresh_token`) before using it, so the Railway variable only matters on
the first run. If Redis is wiped or the token is revoked, run step 2 again.

## Local testing

```bash
pnpm --filter @oracle-markets/xbot test        # parser + reply formatting
pnpm run build:xbot
REDIS_URL=redis://localhost:6379 XBOT_FIXTURE=workers/xbot/fixtures/mentions.sample.json \
  node workers/xbot/dist/index.js              # scripted mentions; forced dry run; no X calls
```

Replies read the keeper's Redis snapshot (`cache:markets`, `cache:groups`), so
run the keeper against the same Redis.

## Bets from X (`bet?`)

Someone posts a take; someone else replies "@bot bet? by Oct 20" (optionally
"… in 30m" / "… in 1d" to choose how long staking stays open; default
`XBOT_BET_STAKE_HOURS`, 1h). The bot:

1. Opens a Bet Vault on the take (question = the post's text, clipped to 64
   bytes on-chain; the full text and a link to the post are stored as
   `bets:meta:<id>` for the `/bet/<id>` page). It's one bet per take: a second
   `bet?` gets the existing links.
2. Replies once, only to the person who tagged it, with stake links
   (`/bet/<id>?buy=yes&amount=10`). It never tags the rest of the thread.
3. Launches the market when staking closes (`advanceBets`, every poll). Launch
   requires stakes on both sides, odds between 1% and 99%, and the minimum total;
   otherwise stakers refund 1:1 on the bet page.
4. After the deadline, **you** resolve in `/admin` → *Bets to resolve*. The bot
   (or anyone) settles, and winners claim on the bet page. If you never resolve,
   anyone can void it after 7 days and everyone is refunded.

Add a category hashtag to file the bet (`#crypto`, `#sports`, `#politics`,
`#science`, `#culture`, `#finance`, `#weather`, `#personal`), either in the `bet?`
reply or in the take itself; the reply's tag wins. The launched market inherits
it on the site.

Deadlines must be 1 hour to 30 days after staking closes (the program's limit).
The bot wallet (`XBOT_WALLET`) can open and launch bets but can never resolve
them; only `XBOT_BET_RESOLVER` can. Limits: `XBOT_BETS_PER_DAY`,
`XBOT_BETS_PER_USER_PER_DAY`, and a SOL floor (`XBOT_MIN_SOL`). Bets are off
unless both `XBOT_WALLET` and `XBOT_BET_RESOLVER` are set. **Devnet only**: on
mainnet this is peer-to-peer wagering with real money, so get legal advice first.

End-to-end test (devnet, about 8 minutes): `scripts/e2e-bets.ts` (see its header).

