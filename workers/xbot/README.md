# xbot: the Oracle Markets mention bot

A Railway worker that answers people who **@mention the bot account** on X
with market links. Those links unfurl as share cards and, for wallets with
Blinks enabled, as YES/NO buttons. The bot **never trades**, holds no wallet,
and never creates markets.

## Commands

Commands are parsed by fixed rules first (Claude helps only when they fall
short; see *Claude assist* below). Typos and synonyms work
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


## Claude assist (optional)

Set `ANTHROPIC_API_KEY` on the xbot service to turn it on. Without it, the bot
behaves exactly as before. Two jobs, both **fail-open** (an error, a timeout or
the daily cap falls back to the rules):

- **Reading mentions** (`XBOT_CLAUDE_MODEL`, default `claude-haiku-4-5-20251001`):
  called only when the rules don't fully understand a post: free text with a
  topic ("I'll take that, loser pays, before christmas") or a `bet?` without a
  usable date. Small talk never calls Claude. Claude's reading is used only
  when it's a concrete bet / odds / markets request; hashtags and "in 2h"
  windows from the rules still win.
- **Writing the market** (`XBOT_CLAUDE_REFINE_MODEL`, default `claude-sonnet-5-5`):
  before a bet opens, the take becomes a short yes/no question (the on-chain
  name) plus *How it resolves* rules, shown on `/bet/<id>` with the original
  take. It also picks a category when there's no hashtag, and refuses bets on
  death, injury or violence, sexual content, minors, crimes, or the private
  life of someone outside the conversation.

Post text is untrusted: Claude can only fill a fixed schema, every value is
validated (dates, windows, categories), and the usual bet limits apply before
anything reaches the chain. Claude never holds a key and never resolves.
Cap: `XBOT_CLAUDE_PER_DAY` (default 300 calls); timeout `XBOT_CLAUDE_TIMEOUT_SECS` (20).

## Market art (optional)

With Claude on, every poll the bot also draws a small flat SVG illustration for
live markets, groups, vaults and bets that don't have one yet, from the
keeper's cache, so markets created on the site get art too. Group legs and
markets launched from a vault or bet use the parent's art. The site shows it on
cards, market/group/bet pages and the X share cards (`/api/art/<account>`).

- Stored in Redis: hash `art` (account → SVG); failed attempts in `art:fails`
  (2 tries per account).
- Safety: Claude's SVG is untrusted. `sanitizeSvg` accepts only plain shapes and
  gradients (no scripts, styles, text, links, images or external URLs), and the
  web serves it with a no-script CSP and `nosniff`.
- `XBOT_ART_MODEL` (default `claude-sonnet-5-5`), `XBOT_ART_PER_DAY` (40),
  `XBOT_ART_PER_PASS` (2), `XBOT_ART=false` to turn it off. It has its own daily
  budget, separate from the mention/bet budget.

## Trading from X (devnet, custodial)

People trade by replying to the bot. Each X account gets its own Solana wallet on
first use, funded with `XBOT_STARTER_USDC` (50) test USDC from the bot wallet's
USDC float. Commands (fixed rules, never Claude):

| Reply | Does |
|---|---|
| `buy YES $5` / `buy NO 10` | trade the market in the thread (link in the post, the bet on the take, or `#<id>`) |
| `sell YES` / `sell YES $3` | sell all / about $3 worth |
| `stake YES $10` | stake in a bet that's still taking stakes |
| `balance` | cash + top positions |
| `withdraw $20 to <address>` / `withdraw all to <address>` | send USDC out |

A `bet?` reply with a side and amount ("…I'll take YES $10") also stakes for the
caller. Winnings, settled bets and refunds are paid out automatically each poll,
and the bot replies under the post that opened the position.

- **Keys**: `wallets.ts`. One keypair per X user id in Redis hash `xwallets`,
  secret encrypted with AES-256-GCM under `XBOT_WALLET_MASTER_KEY` (base64 of 32
  bytes; Railway only), with the user id as associated data.
- **Fees**: the bot wallet pays every fee and token-account deposit (~0.006 SOL per
  new user + market), plus the small rent a bet stake needs. Keep it funded with
  devnet SOL and test USDC.
- **Limits**: `XBOT_MAX_TRADE_USDC` (25), `XBOT_DAILY_USDC` (100 traded, and 100
  withdrawn, per user per day), `XBOT_MAX_IMPACT_BPS` (1500: refuse a trade whose
  average price is >15% + fee worse than now; devnet markets are thin),
  `XBOT_SLIPPAGE_BPS` (200), one action at a time per user.
- **Site**: `/wallet` → "Sign in with X" (OAuth 1.0a with the app's `X_API_KEY` /
  `X_API_SECRET`; add `https://oraclemarkets.app/api/auth/x/callback` to the X
  app's callback URLs). Shows balance and positions and can export the private
  key (base58, for Phantom) after a sign-in in the last 15 minutes. The web
  service needs the same `XBOT_WALLET_MASTER_KEY` plus `X_API_KEY` / `X_API_SECRET`.
- **Devnet only**: the bot refuses to start with a master key against real USDC
  or a mainnet RPC. Mainnet needs a managed key service and legal review.
- End-to-end: `scripts/e2e-money.ts`.
