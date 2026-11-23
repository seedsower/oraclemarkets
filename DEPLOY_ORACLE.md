# Deploying the Oracle Markets program — runbook

For a **human** to run, top to bottom. Nothing here has been run yet. Every
step that spends SOL or changes who controls the program is marked.

| | |
|---|---|
| Program ID | `97ySR6vWkxCC1oPbB2ytRSmKos4mExanuTu2e9VmoXcX` |
| Program keypair | `anchor/target/deploy/pm_amm-keypair.json` (git-ignored) — backup at `~/.config/solana/oracle-markets-pm_amm-program-keypair.json` |
| Fee wallet (`PROTOCOL_DAO`) | `zzWmQZ1bn6QqTwPcf4pZrfhbTmJBmeimk1mieNRvUB6` — Squads multisig **vault** (off-curve PDA; verified on mainnet) |
| Swap fee (`SWAP_FEE_BPS`) | `100` = 1% on the USDC leg: 0.5% fee wallet + 0.5% market creator |
| Code | branch `oracle-program` (upstream `sparkfun-labs/pm-amm` + PR #9 + re-key). **Do not merge to `main` before step 7** (Railway deploys `main`). |
| Built `.so` | 1,513,024 bytes, sha256 `a4d2cff0bea5aab991e56c6802f1ec4d0ba47dcc6ea66a208398f169ee056706` (rebuild and compare) |

> ⚠️ **The program keypair is the only way to deploy to this ID.** Keep the
> backup. If it is lost before the first deploy, generate a new one and re-run
> Phase 1 of `doc/ORACLE_CONTRACT_DEPLOY_PROMPT.md` (new ID everywhere).

---

## 1. Pre-flight

```bash
# Toolchain pinned in anchor/Anchor.toml
avm install 1.0.1                      # Anchor CLI 1.0.1 (avm use 0.31.1 afterwards if other projects need it)
agave-install init 3.0.14              # Solana CLI pinned by the project (anchor also switches to it)
rustup toolchain install stable        # host Rust ≥ 1.85 (the repo's deps need it; 1.78 fails)

# Build (exactly how the binary above was produced)
cd anchor
RUSTUP_TOOLCHAIN=stable cargo-build-sbf --tools-version v1.52 \
  --manifest-path programs/pm_amm/Cargo.toml --sbf-out-dir target/deploy
mkdir -p target/idl target/types
RUSTUP_TOOLCHAIN=stable anchor idl build -o target/idl/pm_amm.json -t target/types/pm_amm.ts
cd .. && node scripts/sync-idl.mjs
sha256sum anchor/target/deploy/pm_amm.so            # record it
solana-keygen pubkey anchor/target/deploy/pm_amm-keypair.json   # must print 97ySR6vW…oXcX
grep -A3 '"constants"' idl/pm_amm.json              # PROTOCOL_DAO = zzWm…, SWAP_FEE_BPS = 100
```

Verifiable build (`anchor build --verifiable`) needs Docker; if you have it,
use it for the **mainnet** binary and publish the hash. Otherwise record the
sha256 above.

Deployer wallet (`$DEPLOYER`, becomes the first upgrade authority until step 5):

```bash
export DEPLOYER=~/.config/solana/<your-deployer>.json
solana balance $(solana-keygen pubkey $DEPLOYER) --url devnet
```

Rent for this binary (checked on devnet and mainnet, same rate):

| Program data size | Rent (locked while the program exists) |
|---|---|
| exact (1,513,069 B) | 7.69 SOL |
| `--max-len 1700000` (recommended: room for upgrades) | 8.64 SOL |
| default 2× (3,026,093 B) | 15.37 SOL |

Plus a **temporary upload buffer** of the same size as the binary (~7.69 SOL),
refunded when the deploy completes, plus fees. **Have ~17 SOL** for a
`--max-len 1700000` deploy.

## 2. Devnet deploy  (spends devnet SOL)

```bash
solana program deploy anchor/target/deploy/pm_amm.so \
  --program-id anchor/target/deploy/pm_amm-keypair.json \
  --keypair "$DEPLOYER" --upgrade-authority "$DEPLOYER" \
  --max-len 1700000 \
  --url https://api.devnet.solana.com --with-compute-unit-price 10000

solana program show 97ySR6vWkxCC1oPbB2ytRSmKos4mExanuTu2e9VmoXcX --url devnet
# Record: Data Length, Balance (rent), Authority (= $DEPLOYER for now)
```

## 3. Fee wallet's USDC account

`swap` sends the DAO half of the fee to the USDC **associated token account
owned by `PROTOCOL_DAO`**. A Squads vault is a PDA, so the account must be
created with an off-curve owner. (The SDK's swap builder also creates it on
the first trade if it's missing, but create it up front so fees never fail.)

| Cluster | Collateral mint |
|---|---|
| devnet | the app's mock USDC `3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ` (see note below) |
| mainnet | real USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |

```bash
# from workers/xbot (has @solana/spl-token); RPC + MINT per cluster
RPC=https://api.devnet.solana.com MINT=3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ \
KP=$DEPLOYER npx tsx -e '
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.KP!, "utf8"))));
const dao = new PublicKey("zzWmQZ1bn6QqTwPcf4pZrfhbTmJBmeimk1mieNRvUB6");
(async () => {
  const ata = await getOrCreateAssociatedTokenAccount(
    new Connection(process.env.RPC!, "confirmed"), payer, new PublicKey(process.env.MINT!), dao, true /* off-curve owner */);
  console.log("DAO USDC account:", ata.address.toBase58());
})();'
```

> **Devnet test USDC note.** `3WQ8…`'s mint authority belongs to the upstream
> team (`EftrgEw3…`), so you can't mint it, only get it from their faucet.
> The program is collateral-agnostic. Either keep `3WQ8…` (keeps the existing
> faucet and the X bot's float working) or create your own devnet mint and set
> `NEXT_PUBLIC_USDC_MINT` / `USDC_MINT` everywhere (then re-fund the bot float).
> Decide before step 4.

## 4. Devnet smoke test

Point the scripts at the new program (they already use the new ID) and run:

```bash
node scripts/e2e-devnet.cjs              # create → trade → resolve → claim
node scripts/e2e-bet-vault-devnet.cjs    # commit → launch → resolve → settle → claim
```

Both mint test USDC with `MINT_AUTHORITY_KEYPAIR` (default
`~/.config/solana/pm-amm-devnet-mint.json`) — **you don't have that key for
`3WQ8…`** (see the note above). Either use your own mint (and its authority),
or fund the test wallets from the faucet and skip the minting step. The X bot's
end-to-end scripts (`workers/xbot/scripts/e2e-money.ts`, `e2e-money-bets.ts`)
are an alternative that uses the bot's USDC float:
`PROGRAM_ID=97ySR6vWkxCC1oPbB2ytRSmKos4mExanuTu2e9VmoXcX railway run --service xbot -- …`.

Then confirm fees landed:

```bash
spl-token balance --address <DAO USDC account from step 3> --url devnet   # > 0 after a USDC swap
```

Expected per USDC→YES/NO swap of `A` (raw): fee = ⌊A × 100 / 10 000⌋, DAO gets
⌊fee / 2⌋, creator the rest.

## 5. Hand the upgrade authority to the Squads vault  (irreversible from the old key)

> ┌──────────────────────────────────────────────────────────────────────┐
> │ ⚠️  After this, ONLY the Squads multisig can upgrade or close the    │
> │ program. `$DEPLOYER` loses all control. A typo sends control to an   │
> │ address nobody holds = the program can never be upgraded again.     │
> │ Copy the vault address from the Squads app, compare every character, │
> │ and do it on devnet first.                                           │
> └──────────────────────────────────────────────────────────────────────┘

```bash
export SQUADS_VAULT=<vault address from the Squads app>   # e.g. the same vault as the fee wallet
solana program set-upgrade-authority 97ySR6vWkxCC1oPbB2ytRSmKos4mExanuTu2e9VmoXcX \
  --upgrade-authority "$DEPLOYER" \
  --new-upgrade-authority "$SQUADS_VAULT" \
  --skip-new-upgrade-authority-signer-check \
  --url devnet
solana program show 97ySR6vWkxCC1oPbB2ytRSmKos4mExanuTu2e9VmoXcX --url devnet   # Authority = $SQUADS_VAULT
```

Then in the Squads app, check you can propose an upgrade for this program.

## 6. Mainnet  (real SOL — gated)

Do not start until **every** box is ticked:

- [ ] Independent security audit of this program completed (the upstream program was never audited)
- [ ] Legal sign-off (prediction markets / bets with real money; X wallets stay devnet-only)
- [ ] Squads multisig signers and threshold confirmed
- [ ] Fee wallet `zzWm…` re-verified in the Squads app (vault, not the multisig account)
- [ ] Devnet steps 2–5 done and smoke tests green
- [ ] App, keeper and bot env updates ready (step 7)
- [ ] Dedicated mainnet RPC (the public one rate-limits deploy writes)

```bash
MAINNET_RPC_URL=<dedicated RPC> MAINNET_AUTHORITY_KEYPAIR="$DEPLOYER" \
MAINNET_MAX_LEN=1700000 bash anchor/scripts/deploy-mainnet.sh
```

Then step 3 with the mainnet RPC and real USDC, and step 5 with `--url` set to
the mainnet RPC. The upload buffer (~7.7 SOL) is refunded after the deploy
completes; the program-data rent (~8.6 SOL at `--max-len 1700000`) stays locked
while the program exists. Upgrades later need the same buffer again, and
`solana program extend` if the binary outgrows 1,700,000 bytes.

## 7. Switch the app, keeper and bot to the new program

Only after the program is deployed on that cluster:

1. Merge branch `oracle-program` into `main`. The SDK now hard-codes the new fee
   wallet and 1% fee, so **swaps on the old program would fail** if this reached
   production while the app still pointed at `GV1F…`. Merge and switch together.
2. Railway:
   - `app`: `NEXT_PUBLIC_PROGRAM_ID=97ySR6vWkxCC1oPbB2ytRSmKos4mExanuTu2e9VmoXcX`
     (build-time: set it, then deploy)
   - `@oracle-markets/keeper`: `PROGRAM_ID=97ySR6vWkxCC1oPbB2ytRSmKos4mExanuTu2e9VmoXcX`
   - `xbot`: `PROGRAM_ID=97ySR6vWkxCC1oPbB2ytRSmKos4mExanuTu2e9VmoXcX`
   - If you changed the devnet mint in step 3: `NEXT_PUBLIC_USDC_MINT` / `USDC_MINT` too.
3. **Markets on the old program.** The app, keeper and bot read **one**
   program ID. After the switch, markets, bets, X-wallet positions and pending
   payouts on `GV1F…` disappear from the site and the bot (the funds stay safe
   on-chain on the old program). Keeping the old program readable until its
   markets resolve is **separate app work** (multi-program reads in the keeper
   cache, the site and the bot's payout pass). Either do that first, or switch
   once the old markets have resolved and been claimed.
4. Update `CLAUDE.md` / `DEVNET.md` / `MAINNET.md` / `README.md`: remove the
   "not deployed yet" note and record the deploy (slot, data length, rent,
   upgrade authority).

## Toolchain note

`anchor test` / `anchor build` with this repo's `Anchor.toml` switch the
**global** Solana CLI to 3.0.14 (via `agave-install`). Switch back with
`agave-install init <version>` if other projects need another one. Local
tests: Anchor 1.0's default validator is `surfpool`; with the legacy
`solana-test-validator` 3.0.14, `bind_address = "0.0.0.0"` in `Anchor.toml`
crashes the validator — start it yourself on `127.0.0.1` with
`--bpf-program` for this program and Metaplex, then
`anchor test --validator legacy --skip-local-validator --skip-deploy --skip-build`.
