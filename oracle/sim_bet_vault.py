"""
Payout simulator for Bet Vault v2 (anchor/programs/pm_amm/src/instructions/bet/).
Asserted on-chain by anchor/tests/bet_vault.ts (lp 50%, Carol buys YES for 20).

Model
-----
- Pot T = yes_total + no_total. Launch price p = yes_total / T.
- lp_share of the pot is deposited as pm-AMM liquidity (with the entry-side
  surplus fix: collateral = max(x, y), the excess side is minted back to the
  vault). The rest stays as USDC in the vault.
- The vault PDA is market.authority, so the creator half of the 2% swap fee
  lands in the pot.
- One outside trader (Carol) buys YES for `buy` USDC right after launch.
- At resolution the vault's whole value goes to the WINNING side pro-rata;
  losers get 0.

Simplification: single swap at launch, no dC_t time decay (all reserves are
released to the vault by resolution anyway), static L_eff.
"""

from scipy.optimize import brentq
from scipy.stats import norm

FEE = 0.02


def simulate(yes_total, no_total, lp_share, buy):
    T = yes_total + no_total
    p = yes_total / T
    lp = T * lp_share
    kept = T - lp

    yes_held = no_held = 0.0  # tokens held by the vault outside the pool
    x = y = 0.0
    if lp > 0:
        u = norm.ppf(p)
        cy = u * p + norm.pdf(u)
        cx = cy - u
        L = lp / max(cx, cy)
        x, y = cx * L, cy * L
        yes_held, no_held = lp - x, lp - y  # entry-side surplus fix

        fee = 0.0
        if buy > 0:
            fee = buy * FEE
            net = buy - fee
            f = lambda xx, yy: (yy - xx) * norm.cdf((yy - xx) / L) + L * norm.pdf((yy - xx) / L) - yy
            y1 = y + net
            x1 = brentq(lambda xx: f(xx, y1), -1e-9, x + 1e-9)
            x, y = x1, y1
        creator_fee = fee / 2
    else:
        creator_fee = 0.0

    pot_if_yes = kept + yes_held + x + creator_fee
    pot_if_no = kept + no_held + y + creator_fee
    return {
        "alice_if_yes": pot_if_yes,  # Alice = the only YES committer
        "bob_if_no": pot_if_no,  # Bob = the only NO committer
    }


if __name__ == "__main__":
    print("Alice 70 YES / Bob 30 NO -> launch at 70%. Loser always gets 0.\n")
    print(f"{'LP share':>9} | {'Carol buys YES':>14} | {'Alice if YES wins':>17} | {'Bob if NO wins':>14}")
    print("-" * 64)
    for lp_share in (0.0, 0.3, 0.5, 1.0):
        for buy in (0,) if lp_share == 0 else (0, 10, 20, 40):  # no pool -> nobody can trade
            r = simulate(70, 30, lp_share, buy)
            print(
                f"{lp_share:>8.0%} | {buy:>13} $ | {r['alice_if_yes']:>15.2f} $ | {r['bob_if_no']:>12.2f} $"
            )
        print("-" * 64)
