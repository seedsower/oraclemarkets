/**
 * Seed a few devnet markets on the Oracle Markets program so the board isn't
 * empty after the switch. The creator (CREATOR_KEYPAIR) is each market's
 * authority, i.e. its resolver (resolve them from /admin with that wallet).
 *
 *   CREATOR_KEYPAIR=~/.config/solana/<creator>.json npx tsx scripts/seed-oracle-program.ts
 *
 * Prints `marketId pubkey category` per market (categories are set separately,
 * by signing /api/categories as the creator).
 */
import { readFileSync } from "node:fs";
import { AnchorProvider, Wallet } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { PmAmmClient } from "@pm-amm/sdk";

const PROGRAM = new PublicKey("97ySR6vWkxCC1oPbB2ytRSmKos4mExanuTu2e9VmoXcX");
const USDC = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");
const DAY = 86_400;

/** name (≤ 64 bytes), deadline (UTC date), YES seed price (bps), category. */
export const SEEDS: { name: string; until: string; bps: number; category: string }[] = [
  {
    name: "Will BTC close above $120k on Dec 31, 2026?",
    until: "2026-12-31",
    bps: 3500,
    category: "crypto",
  },
  {
    name: "Will SOL trade above $250 on Dec 15, 2026?",
    until: "2026-12-15",
    bps: 3000,
    category: "crypto",
  },
  {
    name: "Will the Fed cut rates at its Dec 2026 meeting?",
    until: "2026-12-17",
    bps: 5500,
    category: "finance",
  },
  {
    name: "Will Salt Lake City get 6+ in of snow by Dec 15, 2026?",
    until: "2026-12-15",
    bps: 4000,
    category: "weather",
  },
  {
    name: "Will the Lakers win 8+ games in December 2026?",
    until: "2026-12-31",
    bps: 4500,
    category: "sports",
  },
  {
    name: "Will GTA VI get a new release date by Dec 31, 2026?",
    until: "2026-12-31",
    bps: 3000,
    category: "culture",
  },
];

async function main() {
  const path = (process.env.CREATOR_KEYPAIR ?? "~/.config/solana/id.json").replace(
    /^~/,
    process.env.HOME!,
  );
  const creator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  const conn = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  const provider = new AnchorProvider(conn, new Wallet(creator), { commitment: "confirmed" });
  const client = PmAmmClient.fromProvider(provider, PROGRAM, USDC);
  const now = Math.floor(Date.now() / 1000);
  for (const s of SEEDS) {
    const end = Math.floor(Date.parse(`${s.until}T23:59:59Z`) / 1000);
    if (end - now < DAY) throw new Error(`${s.name}: deadline too close`);
    const r = await client.send.createMarket({
      name: s.name,
      durationSecs: end - now,
      initialPriceBps: s.bps,
      depositUsdc: Number(process.env.SEED_USDC ?? 100),
    });
    console.log(`${r.marketId} ${r.marketPda} ${s.category}  ${s.name}`);
  }
}

main().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
