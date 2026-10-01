# Blinks (Solana Actions) for Oracle Markets

A market link posted on X can unfurl into **YES / NO buy buttons** for people
with a Blink-capable wallet extension. Everyone else sees the normal share card
and taps through to the site.

Every trade is **non-custodial**: the server only builds an *unsigned*
transaction. The user's own wallet shows it, signs it, and sends it. The server
never holds user funds or keys.

## What's served

| URL | Purpose |
|---|---|
| `/actions.json` | Discovery (must be at the domain root): `/market/*` → `/api/actions/market/*`, `/group/*` → `/api/actions/group/*` |
| `GET /api/actions/market/<marketId>` | Title, live prices, close time, who resolves it, and buttons: YES $5, YES $25, NO $5, NO $25, plus "Buy YES" / "Buy NO" with an amount box |
| `POST /api/actions/market/<marketId>?side=yes\|no&amount=N` | Body `{ "account": "<wallet>" }` → unsigned transaction + message ("Buying ~9.59 YES at ≈52¢. 2% fee included.") |
| `GET /api/actions/group/<groupId>` | Up to 6 outcomes as "<Outcome> YES $10" buttons |
| `POST /api/actions/group/<groupId>?leg=<index>&amount=N` | Buys YES on that outcome's market (same code path) |

All responses carry the Actions CORS headers plus `X-Action-Version: 2.4` and
`X-Blockchain-Ids` (devnet or mainnet, from `NEXT_PUBLIC_SOLANA_CLUSTER`).

### What the server checks before returning a transaction

1. The wallet is a valid on-curve address, side/amount are valid, and the amount is between 1 and `ACTIONS_MAX_USDC`.
2. Rate limits: 10 builds/min per wallet, 30/min per IP.
3. The market is open, liquid, USDC-collateralised and, with `ACTIONS_FEATURED_ONLY=true`, featured.
4. The wallet holds enough USDC. If not: "You need 25 USDC in this wallet."
5. The swap is built by the SDK's `buildSwapTx`, the same instructions `send.swap` uses, with `ACTIONS_SLIPPAGE_BPS` slippage.
6. The transaction is **simulated**. If it would fail (no SOL for fees, price moved), the user gets a clear message instead of a doomed transaction, and the confirmation message uses the simulated fill.
7. **Program allowlist**: the returned transaction may only call ComputeBudget, Associated Token and the pm-AMM program. A bare SPL token transfer is refused, since its only use here would be draining the signer. This runs again on the final bytes, because `@solana/actions` appends a memo instruction when `ACTION_IDENTITY_SECRET` is set. **Don't set that variable**: every trade would then be refused.

### Variables (`app` service)

| Variable | Default | |
|---|---|---|
| `ACTIONS_MAX_USDC` | `250` | Max per Blink trade |
| `ACTIONS_SLIPPAGE_BPS` | `200` | 2% |
| `ACTIONS_FEATURED_ONLY` | `false` | `true` = only markets by `NEXT_PUBLIC_FEATURED_AUTHORITIES` get buttons |
| `SERVER_RPC_URL` | public cluster | Server-side RPC for building/simulating, never the browser key |

## Testing on devnet

**Automated:** a real $5 YES buy, signed locally:

```bash
E2E_KEYPAIR=~/devnet-tester.json \
BLINK_BASE_URL=https://<your-domain> [MARKET_ID=<id>] [AMOUNT=5] \
NODE_PATH=app/node_modules node scripts/e2e-blink-devnet.cjs
```

The wallet needs a few mock USDC and ~0.01 SOL. The devnet faucet
(`POST <SITE_URL>/api/faucet {"wallet":"…"}`) provides both once
`MINT_AUTHORITY_KEY` is set.

**In a browser:**

- **Blinks Inspector**: <https://www.blinks.xyz/inspector>. Paste
  `https://<your-domain>/market/<marketId>` to see the GET response and buttons,
  and run the POST with your wallet.
- **dial.to interstitial**: `https://dial.to/?action=solana-action:https://<your-domain>/api/actions/market/<marketId>`
- Your wallet must be on **devnet** to sign devnet transactions (in Phantom,
  Settings → Developer Settings → Testnet Mode).

**On X (desktop):**

1. Phantom extension: **Settings → Experimental Features → turn on Solana
   Actions / Blinks**, then reload x.com. Backpack and Solflare have similar
   settings.
2. Post (or view) a market URL such as `https://<your-domain>/market/<marketId>`.
3. Until the domain is registered (below), wallets render it as a normal link
   with the share card. Only registered Actions unfurl in the X feed.

## Registering the domain with Dialect

Wallets that render Blinks on X only unfurl Actions from Dialect's registry.
Unregistered domains show as plain links (with the Phase 1 share card).
Registration is a **manual review**:

- Submit via Dialect: their docs say to email **hello@dialect.to**, and the
  Solana Actions guide links the form at **<https://dial.to/register>**. Use
  whichever is current.
- Before submitting, make sure the Action works reliably (the e2e script above),
  descriptions are clear, and you're on your **final domain**. Registration is
  per domain, so register the custom domain, not `*.up.railway.app`.
- Include accurate contact details; reviewers follow up. No turnaround time is
  published.
- Browse the registry at <https://dial.to/registry> (API:
  `https://registry.dial.to/v1/list`).

## Limits to know

- **Desktop + extension only.** Unfurling on X needs a desktop browser with a
  Blink-capable wallet extension and a registered domain. **Mobile X users see the
  share card** and tap through to the site to trade.
- Blinks only **buy** (USDC → YES/NO). Selling, LP and claims stay in the app.
- Markets with non-USDC collateral, and resolved or expired markets, return
  `disabled: true` with an explanation.
- Resolution is admin-signed by the market creator, and the Blink description says
  so. There is no oracle.

Sources: [Dialect — Register your Blink](https://docs.dialect.to/blinks/blinks-provider/blink-registry) ·
[Solana — Actions and Blinks guide](https://solana.com/developers/guides/advanced/actions) ·
[Phantom — Solana Actions and Blinks](https://docs.phantom.com/developer-powertools/solana-actions-and-blinks) ·
[Dialect — Blinks Public Registry](https://docs.dialect.to/documentation/actions/the-blinks-public-registry)
