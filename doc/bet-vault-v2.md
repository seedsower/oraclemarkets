# Sprint 25 — Bet Vault v2 + entry-side surplus fix

Merged in `sparkfun-labs/pm-amm#1`. Live on devnet and mainnet (`GV1F…N16y`)
since 2026-09-23 — mainnet upgrade in slot 449755892, same `.so` as devnet.

Source: Mathis's handoff (2026-09-22), reproduced on the live program with a
local validator. Two independent pieces, in dependency order.

## 1. Entry-side surplus (collateral that no token could claim)

**Bug.** Every liquidity deposit calibrates `L_0` so `max(x, y) = deposit`
(fix #1, the solvency requirement) and locks `deposit` collateral. But the pool
only holds `x` YES + `y` NO, so `|y − x|` of the deposit backed **no token at
all**. When the smaller-reserve side won, that collateral stayed in the market
vault forever: no instruction could move it (`claim_winnings`, `redeem_pair` and
`swap` all need tokens). At 70%, a 100 USDC deposit left **73.37 USDC** stuck.
It hit every market seeded away from 50% — plain `deposit_liquidity`, the
binary commitment vault (audit #6 deposits the whole pot), and group legs.

**Fix.** The surplus is now credited to the depositor as a claim and minted
lazily:

- `LpPosition::excess_yes / excess_no` — the depositor's surplus, carved out of
  the account's former tail padding (`LEN` unchanged, existing positions read 0).
- `Market::unclaimed_excess_yes / _no` — the market-wide total, carved out of
  `Market`'s padding (`LEN` stays 443). The swap solvency guard now counts it:
  `vault ≥ max(supply + reserve + unclaimed_excess)` per side, which holds with
  equality on both sides instead of leaving a silent gap.
- `claim_lp_residuals` and `withdraw_liquidity` mint it alongside the dC_t
  residuals (withdraw releases all of it, so closing the position can't lose it).
- `launch_vault_market` records the launch surplus on `CommitmentVault`
  (`launch_excess_*`, also from padding) and `claim_committer` gives each
  committer their pro-rata slice.

Minting lazily (instead of minting the excess at deposit time, as the handoff
suggested) keeps **every existing instruction's account list unchanged** — no
client breakage, no new ATAs in `deposit_liquidity`.

**Not covered:** collateral already stranded on deployed markets. A mainnet scan
(read-only, 2026-09-22) found 10 markets, no commitment vaults, and a single
affected market — "Will France Score First ?", seeded at 60%, resolved YES, with
**4.71 USDC** stuck. Recovering it needs a separate `claim_lp_surplus` (LP shares
are burned on withdraw, so it needs a snapshot). Deferred, pending Ewan.

## 2. Bet Vault v2 — winner takes the pot, the pot is the liquidity

New accounts (`BetVault`, `BetPosition`) and 7 instructions under
`instructions/bet/`. The Sprint 22/23 `CommitmentVault*` accounts and
instructions are untouched.

- Committers are **bettors**: stakes set the odds (`price = yes_total / total`),
  and at resolution the winning side splits everything the vault owns, pro-rata
  to stake; losers get 0.
- `effective_lp_bps` of the pot is deposited as liquidity **owned by the vault
  PDA**, so outsiders can trade; the rest stays as USDC in the vault.
- The vault PDA is `market.authority`: it is the only resolver (no key can sign
  for it) and the creator half of the swap fee flows back into the pot.
- `launch_bet_vault` / `resolve_bet_vault` are authority/resolver-only, fixing
  the `launch_vault_market` hole where any stranger could launch, become
  `market.authority`, and then resolve the market however they liked.

### If the resolver never shows up

`void_bet_vault` is the fallback: permissionless, once `market.end_ts +
void_grace_secs` has passed with the market still unresolved (per-vault grace,
300 s..30 days, default 7 days). The vault converts its whole liquidity slice
back to collateral and `claim_bet` then refunds **every** committer pro-rata to
their stake — no winner, no loser.

It only works because of the surplus fix: the vault's claims are worth the same
on both sides, so `min(yes_owed, no_owed)` — the value of a pair redemption,
computable without an outcome — is the whole slice. Before the fix the
difference would have stayed stuck.

Outside traders holding a single side get nothing from a void: with no outcome,
only complete pairs have a value. Inherent, and the UI must say so.

### The LP cap — why a winner can never get less than their stake

`lp_bps` is clamped at launch to the **favourite's stake share**
(`effective_lp_bps`). Worst case, outside flow drains the pool's reserve on the
winning side, so that side's floor is `kept + its entry-side surplus`:

- underdog: surplus is 0, floor = `total × (1 − lp)` ≥ their stake ⟺ `lp ≤`
  favourite's share (the binding case);
- favourite: floor = `total − lp × x`, and `p · x/y ≤ 1 − p` holds for every
  `p ∈ [0.5, 0.99]` (checked numerically against the oracle), so it is covered.

50% is therefore always safe whatever the odds, and is the app default. 100%
(pure parimutuel) is rejected in effect: it would be capped to the favourite's
share, because at 100% a winning underdog could otherwise end up below stake.

### Payouts (oracle/sim_bet_vault.py, asserted on-chain)

Alice 70 YES / Bob 30 NO, `lp_bps = 5000`, Carol buys YES for 20:

| outcome | Alice | Bob | Carol |
|---|---|---|---|
| no trade, YES | 100 | 0 | — |
| Carol right (YES) | ≈ 94 | 0 | ≈ +6.8 |
| Carol wrong (NO) | 0 | ≈ 119.8 | −20 |

The simulator's `lp_share = 1.0` row is informational only — on-chain it would
be capped to 70%.

## Also fixed

`swap` let any trader pass `creator_usdc = None` and keep the creator half of
the 2% fee (the "swapper IS the creator" shortcut was never checked). Now that
branch requires `signer == market.authority`. This matters more here, since the
creator half is the bet vault's LP compensation.

## Tests

- Rust unit: surplus helpers, odds validity, LP cap (floor ≥ stake for both
  sides across the price range), payout dust sweep, allowlist, account sizes.
- `anchor/tests/lifecycle/bet_vault.ts` (21 tests): the handoff's acceptance
  criteria end-to-end, including "market vault ≈ 0 after all claims" for a
  regular 70% deposit and for a legacy vault launched at 70%, two bettors
  splitting the winning side pro-rata (last claim sweeps the dust), a refund
  below `min_total`, and the void fallback (refused during the grace, then
  refunding both sides in full).

The lifecycle needs a commit window (60 s) and a market to expire (345 s) with
no clock-warp available. `anchor test` runs **surfpool** in per-transaction
block production: the clock only moves when a transaction lands (~0.4 s per
block). So the suite mints blocks with throwaway transfers (`advanceChainTo`)
instead of sleeping — the whole run takes ~25 s — and it runs **last**
(`Anchor.toml` lists `tests/*.ts` then `tests/lifecycle/*.ts`) because it leaves
the chain clock ~400 s ahead of wall time, which would break the other suites'
`Date.now()`-based `end_ts` values.

Gotcha: a surfpool left running from an earlier run is reused, advanced clock
and all. If suites start failing with `InvalidDuration`, `pkill -f surfpool`.

## Devnet run (2026-09-23)

Deployed to devnet (`GV1F…N16y`, upgrade authority `6NG87…`). The program grew
past the account's 1,312,584 bytes, so it needed
`solana program extend GV1F… 220000` first; the deploy itself needs ~7.63 SOL
of buffer rent, refunded on success.

`scripts/e2e-bet-vault-devnet.cjs` (Alice 70 YES / Bob 30 NO, `lp_bps = 5000`,
Carol buys 20 USDC of YES, YES wins) on
[bet vault `7zAqkham…`](https://solscan.io/account/7zAqkhamgCDXLS954pXSmtJKg8jc8bAyaDuh5FfMoCWG?cluster=devnet):

| | result |
|---|---|
| launch | 7000 bps, lp 5000 bps, 50 kept / 50 as liquidity, `market.authority` = vault PDA |
| entry-side surplus credited | 36.68 YES (would have been stranded before the fix) |
| payout pool | 93.9978 |
| Alice (70 on YES) | **+23.99** |
| Bob (30 on NO) | **−30.00** (loser gets 0) |
| Carol (20 on YES) | **+5.80** |
| left in market vault / bet vault | **0.0000 / 0.0000** |

Matches the simulator (≈ 94 for Alice) and the localnet suite. Note the public
devnet RPC rate-limits hard — the script retries with backoff.

### LP shares are minted ∝ the L_0 a deposit adds (dilution fix)

Found in the audit, reproduced on-chain, then fixed. `deposit_liquidity` used to
mint 1 share per USDC on a follow-up deposit. That is only fair while the pool
holds exactly 1 USDC of max-side backing per share, and any trade breaks it:
after Carol buys 20 USDC of YES on a 50-USDC pot, the pool holds ~69.6 NO for 50
shares. A deposit + immediate withdraw then took a pro-rata slice of that NO
pile. Before the surplus fix the round-trip lost its surplus, so it was
unprofitable. With the fix it became a free extraction: Mallory put in 900,
got back 901.83 YES plus a free slice of the NO pile, and Bob's winning pot
fell from ≈119.8 to 101.77.

Shares are now `total_shares × ΔL_0 / L_0` (`shares_for_l_zero_increment`),
floored. L_0 per share never changes (withdraw burns both pro-rata, accrual
leaves L_0 alone), so every LP's slice of the reserves is exactly what they
added. The old ~0.03% drift between two LPs on the same market is gone too:
each gets their deposit back to the rounding dust. Both are asserted in the
lifecycle suite. The SDK's `simulateLpDeposit` mirrors the new minting.

## Open / deferred

1. **`claim_lp_surplus`** for collateral stranded on already-deployed markets
   (4.71 USDC on mainnet today).
2. **Multi-outcome bet vault** — same pattern for a group (winners of the
   winning leg split the pot).
3. **No UI**: the app has no bet-vault page; the flow is SDK-only so far.
4. **Multi-outcome commitment vault (Sprint 23) has the audit-#6 bug**:
   `claim_committer_group` still mints leg YES 1:1 and moves the backing into
   that leg's market vault, so a losing leg's USDC has no token to claim it.
   Not touched here — flagged for its own fix.
5. ~~**Program size**~~ — done: mainnet program data extended to 1,550,000
   bytes (+150,000, tx fee only) before the 2026-09-23 upgrade.
