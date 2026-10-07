import { test } from "node:test";
import assert from "node:assert/strict";
import { BN } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { PmAmmClient, type BetPositionAccount, type BetVaultView } from "@pm-amm/sdk";
import { stakeStatus } from "./use-xwallet";

test("BetPosition decodes with the name the X-wallet page uses", async () => {
  const client = PmAmmClient.readOnly(
    new Connection("http://127.0.0.1:1"),
    new PublicKey("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y"),
    new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ"),
  );
  const owner = Keypair.generate().publicKey;
  const data = await client.program.coder.accounts.encode("betPosition", {
    vault: Keypair.generate().publicKey,
    owner,
    yesAmount: new BN(2_000_000),
    noAmount: new BN(0),
    bump: 254,
  });
  const pos = client.program.coder.accounts.decode<BetPositionAccount>("betPosition", data);
  assert.equal(pos.owner.toBase58(), owner.toBase58());
  assert.equal(pos.yesAmount.toString(), "2000000");
});

const bet = (over: Partial<BetVaultView>) =>
  ({
    launched: true,
    settled: false,
    voided: false,
    refunding: false,
    commitEndTs: 100,
    marketEndTs: 1_000,
    voidGraceSecs: 604_800,
    yesTotal: 2_000_000,
    noTotal: 1_000_000,
    total: 3_000_000,
    minTotal: 1,
    winningSide: 0,
    payoutPool: 0,
    ...over,
  }) as BetVaultView;

test("stake labels follow the bet's phase", () => {
  assert.equal(stakeStatus(bet({ launched: false }), 2e6, 0, 50, false).status, "Taking stakes");
  assert.equal(stakeStatus(bet({}), 2e6, 0, 500, false).status, "Live");
  assert.equal(stakeStatus(bet({}), 2e6, 0, 2_000, false).status, "Waiting for the result");
  const won = bet({ settled: true, winningSide: 1, payoutPool: 3_000_000 });
  assert.match(stakeStatus(won, 2e6, 0, 2_000, true).status, /^Won \$3/);
  assert.equal(stakeStatus(won, 0, 1e6, 2_000, true).status, "Lost");
});
