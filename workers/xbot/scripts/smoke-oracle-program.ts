/**
 * Devnet smoke test for the Oracle Markets program (fee wallet + 1% fee).
 * The creator (CREATOR_KEYPAIR) opens markets; a throwaway trader it funds
 * trades, so the creator fee share and the DAO share are both observable.
 *
 *   CREATOR_KEYPAIR=~/.config/solana/<creator>.json npx tsx scripts/smoke-oracle-program.ts
 *
 * 1. USDC→YES buy: DAO gets ⌊fee/2⌋, creator the rest, fee = ⌊A × SWAP_FEE_BPS / 10 000⌋.
 * 2. Sell back: the fee also comes off the USDC output.
 * 3. Short market: buy YES → resolve YES → claim pays exactly 1 USDC per share.
 * Leftover trader USDC goes back to the creator.
 */
import { readFileSync } from "node:fs";
import { AnchorProvider, Wallet } from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PmAmmClient, PROTOCOL_DAO, SWAP_FEE_BPS, buildSwapTx } from "@pm-amm/sdk";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const PROGRAM = new PublicKey("97ySR6vWkxCC1oPbB2ytRSmKos4mExanuTu2e9VmoXcX");
const USDC = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");
const ONE = 1_000_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);

const conn = new Connection(RPC, "confirmed");
const load = (p: string) =>
  Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(p.replace(/^~/, process.env.HOME!), "utf8"))),
  );
const client = (kp: Keypair) =>
  PmAmmClient.fromProvider(
    new AnchorProvider(conn, new Wallet(kp), { commitment: "confirmed" }),
    PROGRAM,
    USDC,
  );
const ata = (owner: PublicKey, mint = USDC) => getAssociatedTokenAddressSync(mint, owner, true);
const bal = async (a: PublicKey) =>
  Number((await conn.getTokenAccountBalance(a).catch(() => null))?.value.amount ?? 0);

async function send(kp: Keypair, ixs: Parameters<Transaction["add"]>) {
  return sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [kp], {
    commitment: "confirmed",
  });
}

/** Fund a throwaway trader with SOL for fees and `usd` test USDC. */
async function fundTrader(creator: Keypair, trader: Keypair, usd: number) {
  await send(creator, [
    SystemProgram.transfer({
      fromPubkey: creator.publicKey,
      toPubkey: trader.publicKey,
      lamports: 50_000_000,
    }),
    createAssociatedTokenAccountIdempotentInstruction(
      creator.publicKey,
      ata(trader.publicKey),
      trader.publicKey,
      USDC,
    ),
    createTransferCheckedInstruction(
      ata(creator.publicKey),
      USDC,
      ata(trader.publicKey),
      creator.publicKey,
      usd * ONE,
      6,
    ),
  ]);
}

async function swap(
  trader: Keypair,
  market: PublicKey,
  direction: "usdcToYes" | "yesToUsdc",
  amount: number,
) {
  const c = client(trader);
  const built = await buildSwapTx(c, {
    signer: trader.publicKey,
    market,
    direction,
    amount,
    slippageBps: 500,
  });
  await c.sendIxs(built.instructions);
  return built;
}

async function feeCheck(creator: Keypair, trader: Keypair) {
  const { marketPda } = await client(creator).send.createMarket({
    name: "Smoke: 1% fee to the Oracle Markets vault",
    durationSecs: 3600,
    depositUsdc: 100,
  });
  const market = new PublicKey(marketPda);
  const daoAta = ata(PROTOCOL_DAO);
  const creatorAta = ata(creator.publicKey);
  const [dao0, cr0] = [await bal(daoAta), await bal(creatorAta)];
  await swap(trader, market, "usdcToYes", 20);
  const [dao1, cr1] = [await bal(daoAta), await bal(creatorAta)];
  const fee = Math.floor((20 * ONE * SWAP_FEE_BPS) / 10_000);
  say(`buy 20 USDC: fee ${fee / ONE} → DAO +${(dao1 - dao0) / ONE}, creator +${(cr1 - cr0) / ONE}`);
  if (dao1 - dao0 !== Math.floor(fee / 2) || cr1 - cr0 !== fee - Math.floor(fee / 2)) {
    throw new Error("fee split mismatch on the buy");
  }
  const yes = await bal(ata(trader.publicKey, client(trader).yesMint(market)));
  await swap(trader, market, "yesToUsdc", yes / ONE);
  const [dao2, cr2] = [await bal(daoAta), await bal(creatorAta)];
  const sellFee = dao2 - dao1 + (cr2 - cr1);
  say(
    `sell back: fee ${sellFee / ONE} → DAO +${(dao2 - dao1) / ONE}, creator +${(cr2 - cr1) / ONE}`,
  );
  if (dao2 - dao1 !== Math.floor(sellFee / 2) || sellFee <= 0)
    throw new Error("fee split mismatch on the sell");
  return market;
}

async function lifecycle(creator: Keypair, trader: Keypair) {
  const { marketPda } = await client(creator).send.createMarket({
    name: "Smoke: resolve + claim",
    durationSecs: 330,
    depositUsdc: 50,
  });
  const market = new PublicKey(marketPda);
  await swap(trader, market, "usdcToYes", 10);
  const yes = await bal(ata(trader.publicKey, client(trader).yesMint(market)));
  const end = (await client(creator).fetchMarket(market))!.endTs.toNumber();
  say(
    `lifecycle market: holding ${yes / ONE} YES; waiting ${end - Math.floor(Date.now() / 1000) + 5}s for the end`,
  );
  while (Math.floor(Date.now() / 1000) <= end + 3) await sleep(10_000);
  await client(creator).send.resolveMarket(market, "yes");
  const before = await bal(ata(trader.publicKey));
  await client(trader).send.claimWinnings(market);
  const got = (await bal(ata(trader.publicKey))) - before;
  say(`resolved YES; claim paid ${got / ONE} USDC for ${yes / ONE} YES`);
  if (got !== yes) throw new Error("claim didn't pay exactly 1 USDC per winning share");
}

async function main() {
  const creator = load(process.env.CREATOR_KEYPAIR ?? "~/.config/solana/id.json");
  const trader = Keypair.generate();
  say(`program ${PROGRAM.toBase58()}, DAO ${PROTOCOL_DAO.toBase58()}, fee ${SWAP_FEE_BPS} bps`);
  await fundTrader(creator, trader, 60);
  await feeCheck(creator, trader);
  await lifecycle(creator, trader);
  const left = await bal(ata(trader.publicKey));
  if (left > 0) {
    await send(trader, [
      createTransferCheckedInstruction(
        ata(trader.publicKey),
        USDC,
        ata(creator.publicKey),
        trader.publicKey,
        left,
        6,
      ),
    ]);
  }
  say(`✓ smoke passed; ${left / ONE} USDC returned to the creator`);
}

main().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
