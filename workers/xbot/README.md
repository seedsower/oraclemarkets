# xbot: the Oracle Markets mention bot

A Railway worker that answers people who **@mention the bot account** on X
with market links. Those links unfurl as share cards and, for wallets with
Blinks enabled, as YES/NO buttons. The bot **never trades**, holds no wallet,
and never creates markets.

## Commands

Commands are parsed by fixed rules, with no AI. Anything else gets no reply.

| Post | Reply |
|---|---|
| `@bot odds <market id or words>` | Question, `YES 34¢ · NO 66¢ · closes in 3d`, and the market link. Groups show the top 3 outcomes. No match gets a link to the market list. |
| `@bot markets` / `@bot trending` | Top 3 live featured markets with YES prices, plus one link to `/markets?ref=x` |
| `@bot propose <question> by <date>` | "Noted — if we list it, we'll tag you." The proposal is stored and shown in `/admin` → **Proposals from X**. Listing it is your decision. |

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
