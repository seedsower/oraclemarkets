# Coding prompt — Prepare the pm-AMM program for Oracle Markets' own deployment

Paste everything below the line into Claude Code at the root of your fork of **`sparkfun-labs/pm-amm`** (not `Mattdgn/pm-amm`: upstream has no bet vaults, no swap fee and no vault-launch fix). Fill in the three values in "Inputs" first.

---

## Goal

Re-key and re-configure the Solana program so Oracle Markets owns it: its own program ID, its own fee wallet, and a fee level we chose. **Do not change any pricing, payout or settlement math.** A recent review confirmed that `claim_winnings` (pays 1 USDC per winning share) and the bet-vault split (`payout_pool × stake / winning_total`) are correct; a payout bug users saw is in the off-chain app, not here. Work in the phases below, commit after each, and stop at the end of Phase 4: deployment and authority transfer are done by a human.

## Inputs (fill in before starting)

- `NEW_PROTOCOL_DAO` — the address that will **own** the fee USDC token account. Use the Squads multisig **vault** address (not the multisig account itself). `swap.rs` checks `dao_usdc.owner == PROTOCOL_DAO`, so this is a wallet/owner address, not a token account.
- `NEW_SWAP_FEE_BPS` — the total swap fee in basis points. Recommended: `100` (1%, split 50/50: 0.5% to the DAO, 0.5% to the market creator). Must be between 0 and 1000.
- Target cluster for first deploy: `devnet`.

If any input is missing, stop and ask; never guess an address.

## Verified facts about this repo (do not re-derive)

- Program ID `GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y` is compiled in via `declare_id!` in `anchor/programs/pm_amm/src/lib.rs:36` and listed for devnet/localnet/mainnet in `anchor/Anchor.toml`. The same string appears in the SDK IDL (`packages/sdk/src/idl/pm_amm.json`, `pm_amm.ts`), `idl/pm_amm.json`, `app/src/lib/constants.ts`, `app/.env.mainnet.example`, `scripts/*.cjs`, `examples/*`, and several docs.
- Fee constants live in `anchor/programs/pm_amm/src/instructions/swap.rs`: `SWAP_FEE_BPS: u64 = 200` (line 23) and `PROTOCOL_DAO` = `4qXyczAr5DuBVaHUwmZT5Xt6hgQ6RwqBYcFGtrv8QEph` (line 26). `fee_of()` computes `amount × SWAP_FEE_BPS / 10_000` (floor). The fee is split 50/50 DAO/creator; it applies only to swaps with a USDC leg.
- The SDK mirrors both in `packages/sdk/src/constants.ts` (`PROTOCOL_DAO` line 15, `SWAP_FEE_BPS` line 18). They **must** match the program, or every swap the app builds will fail the DAO constraint or misquote.
- Tests hardcode the old DAO in `anchor/tests/access_control.ts:55`, `anchor/tests/pm_amm.ts:23`, `anchor/tests/lifecycle/bet_vault.ts:46`.
- `oracle/sim_bet_vault.py` uses `FEE = 0.02`; `app/src/hooks/use-swap-quote.ts` imports the fee from the SDK.
- The vault-launch hijack (permissionless launcher became the market resolver) is already fixed on `main` (PR #9, merged 2026-10-15). Verify that `launch_vault_market.rs` sets `market.authority` from the vault's creator and that `launch_bet_vault.rs` requires `payer == authority || payer == resolver`. Report if either check is missing; do not re-implement them otherwise.

## Phase 1 — New program ID

1. Generate a fresh program keypair: `solana-keygen new --no-bip39-passphrase -o anchor/target/deploy/pm_amm-keypair.json` (back up any existing file first). **Never commit this keypair**; confirm `anchor/target/` is gitignored, and add an explicit ignore rule for `*-keypair.json` if one isn't there.
2. Run `anchor keys sync` (from `anchor/`) so `declare_id!` and `Anchor.toml` pick up the new ID. Confirm `anchor keys list` matches.
3. Replace the old ID everywhere else in the repo (IDLs, SDK, app constants, env examples, scripts, examples, docs). Use a single repo-wide search for the old string and list every file you changed. The only remaining mentions should be in `CHANGELOG.md` or an "upstream deployment" note, if any.
4. Rebuild with `anchor build` and regenerate the IDL into `packages/sdk/src/idl/` and `idl/` using the repo's existing script (check `package.json` / `CLAUDE.md` for it) rather than hand-editing JSON. The IDL's `address` field must be the new ID.

## Phase 2 — Fee wallet and fee level

1. In `swap.rs`: set `PROTOCOL_DAO` to `NEW_PROTOCOL_DAO` and `SWAP_FEE_BPS` to `NEW_SWAP_FEE_BPS`. Update the doc comments that say "2%" and "Combinator Predict" so they describe the new values and owner.
2. Add a compile-time guard next to the constant: `const _: () = assert!(SWAP_FEE_BPS <= 1_000);`.
3. In `packages/sdk/src/constants.ts`: update `PROTOCOL_DAO` and `SWAP_FEE_BPS` and their comments.
4. Add a single source of truth check: a test (SDK or Anchor side) that reads the built IDL / program constants and asserts they equal the SDK's `PROTOCOL_DAO` and `SWAP_FEE_BPS`. If the IDL doesn't expose the constants, mark them with `#[constant]` in the program so it does.
5. Update the three test files to import `PROTOCOL_DAO` from the SDK instead of hardcoding it. Search the tests for any hardcoded fee arithmetic (`200`, `0.02`, `/ 50`, `98`) and derive it from `SWAP_FEE_BPS` instead.
6. Update `oracle/sim_bet_vault.py` to `FEE = NEW_SWAP_FEE_BPS / 10_000` and make sure `oracle/test_*.py` still pass.
7. Update `MAINNET.md`, `DEVNET.md`, `README.md`, `CLAUDE.md`, `llms.txt`, `doc/api-reference.md`, `app/public/*` wherever they state the fee percentage or the DAO address.

## Phase 3 — Tests

Run, in this order, and fix only failures caused by the changes above:

1. `cargo test` for the program crate (pure math / unit tests).
2. `python3 -m pytest oracle/` (or the repo's documented oracle test command).
3. `pnpm --filter @pm-amm/sdk build && pnpm type-check && pnpm lint`.
4. `anchor test` (full local-validator suite, including `tests/lifecycle/bet_vault.ts`). It is slow; run it in the background and report results.

Add these tests if they don't already exist:
- **Fee routing**: after a USDC→YES swap, the DAO's USDC account increases by exactly `fee_of(amount) / 2` (account for the odd-lamport split as the program does) and the creator's by the remainder.
- **Wrong DAO rejected**: a swap that passes a USDC account owned by any key other than `NEW_PROTOCOL_DAO` fails with `Unauthorized`.
- **Winners are paid in full**: on a resolved plain market, `claim_winnings` pays exactly 1 USDC (in base units) per winning token, regardless of how lopsided trading was.
- **Bet vault floor**: with stakes 50 YES / 575 NO, `lp_bps` of 10%, 30% and 50%, an outside trader buying NO after launch, and NO winning, each NO committer receives at least their stake (expected ≈ 1.08–1.09 × stake at a 2% fee; recompute for the new fee).

If any **existing** test asserts behavior that conflicts with these, stop and report rather than editing the program logic.

## Phase 4 — Deploy runbook (write it, don't run it)

Create `DEPLOY_ORACLE.md` with the exact commands for a human to run, in order:

1. Pre-flight: Solana/Anchor versions from `Anchor.toml` (`anchor_version = "1.0.1"`, `solana_version = "3.0.14"`), deployer wallet balance check, `anchor build --verifiable` if the toolchain supports it.
2. Devnet deploy: `anchor deploy --provider.cluster devnet` (or the repo's deploy script), then `solana program show <NEW_ID> --url devnet` and record the program data size and rent.
3. Create the DAO's USDC token account (associated token account owned by `NEW_PROTOCOL_DAO`, allowing an off-curve owner since a Squads vault is a PDA). Note: on devnet this uses the app's mock USDC mint; on mainnet, real USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.
4. Smoke test on devnet with the repo's e2e scripts updated to the new ID (`scripts/e2e-devnet.cjs`, `scripts/e2e-bet-vault-devnet.cjs`): create, trade, resolve, claim; and a bet vault commit → launch → resolve → settle → claim. Confirm the DAO account received fees.
5. Upgrade authority transfer to the Squads vault: `solana program set-upgrade-authority <NEW_ID> --new-upgrade-authority <SQUADS_VAULT> --skip-new-upgrade-authority-signer-check --url devnet`, with a warning box: this is effectively irreversible from the old key; double-check the address against the Squads app, and do it on devnet first.
6. Mainnet section: same steps, gated behind a checklist (independent audit completed, multisig signers confirmed, fee wallet verified, app env updated, legal sign-off), and a note that the upgrade-buffer rent (~7.7 SOL per the repo's MAINNET.md) is refunded after the upgrade completes.
7. App/env updates after deploy: `NEXT_PUBLIC_PROGRAM_ID`, keeper and bot env, and keep the **old** program ID readable in the app until markets on it resolve (positions on the old program stay there).

## Out of scope — do not do

- Any change to `pm_math.rs`, `accrual.rs`, `lut.rs`, the swap curve, `claim_winnings`, or bet-vault payout math.
- Making the fee or DAO runtime-configurable (a config account adds an admin attack surface; keep compile-time constants).
- Deploying, transferring authority, or touching any keypair other than generating the new program keypair locally.
- App-side fixes (removing the per-share pot split, payout previews, seed liquidity sizing); those are a separate task.

## Report at the end

List: the new program ID, every file changed, test results per suite, any test you added, any check from "Verified facts" that didn't hold, and anything you stopped on.
