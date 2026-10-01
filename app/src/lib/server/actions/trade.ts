import type { NextResponse } from "next/server";
import { createPostResponse, type CompletedAction } from "@solana/actions";
import { PublicKey, Transaction, VersionedTransaction, type Connection } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { buildSwapTx, type MarketView } from "@pm-amm/sdk";
import { USDC_MINT } from "@/lib/constants";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { serverClient } from "@/lib/server/chain";
import {
  ACTIONS_CONFIG,
  actionError,
  actionJson,
  assertAllowedPrograms,
  parseAccount,
  type Side,
} from "./common";
import { buyMessage } from "./market-action";

async function rawTokenBalance(conn: Connection, ata: PublicKey): Promise<number> {
  try {
    return Number((await conn.getTokenAccountBalance(ata, "confirmed")).value.amount);
  } catch {
    return 0; // ATA doesn't exist yet
  }
}

/** Per-wallet and per-IP caps on transaction building (each one costs RPC calls). */
async function limited(req: Request, account: PublicKey): Promise<string | null> {
  const acct = await rateLimit(`actions:acct:${account.toBase58()}`, 10, 60);
  if (!acct.ok) return `Too many requests for this wallet — try again in ${acct.retryAfter}s.`;
  const ip = await rateLimit(`actions:ip:${clientIp(req)}`, 30, 60);
  if (!ip.ok) return `Too many requests — try again in ${ip.retryAfter}s.`;
  return null;
}

function simFailure(err: unknown, logs: string[] | null): string {
  const text = `${JSON.stringify(err)} ${(logs ?? []).join(" ")}`;
  if (/AccountNotFound|InsufficientFundsForFee|insufficient lamports/i.test(text)) {
    return "You need a little SOL in this wallet for network fees and token accounts (~0.01 SOL).";
  }
  if (/Slippage|MinOutput/i.test(text)) return "The price just moved. Please try again.";
  return "This trade would fail right now. Open the market page for details.";
}

/** Simulate unsigned; returns the raw output-token amount received, or an error message. */
async function simulateBuy(
  conn: Connection,
  tx: Transaction,
  outAta: PublicKey,
): Promise<{ received: number } | { error: string }> {
  const before = await rawTokenBalance(conn, outAta);
  const sim = await conn.simulateTransaction(new VersionedTransaction(tx.compileMessage()), {
    sigVerify: false,
    commitment: "confirmed",
    accounts: { encoding: "base64", addresses: [outAta.toBase58()] },
  });
  if (sim.value.err) return { error: simFailure(sim.value.err, sim.value.logs) };
  const data = sim.value.accounts?.[0]?.data?.[0];
  if (!data) return { received: 0 };
  const after = Number(Buffer.from(data, "base64").readBigUInt64LE(64)); // SPL amount @64
  return { received: Math.max(0, after - before) };
}

export interface BuyRequest {
  market: MarketView;
  side: Side;
  amount: number;
  iconUrl: string;
  pageUrl: string;
}

/** POST handler body: validate → limit → balance → build → simulate → guard → respond. */
export async function buildBuyResponse(req: Request, b: BuyRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { account?: unknown } | null;
  const account = parseAccount(body?.account);
  if (!account) return actionError("Invalid wallet address.");
  const limit = await limited(req, account);
  if (limit) return actionError(limit, 429);

  const client = serverClient();
  const conn = client.connection;
  const marketPk = new PublicKey(b.market.publicKey);
  const usdcAta = await getAssociatedTokenAddress(USDC_MINT, account);
  if ((await rawTokenBalance(conn, usdcAta)) < Math.round(b.amount * 1e6)) {
    return actionError(`You need ${b.amount} USDC in this wallet.`);
  }

  const built = await buildSwapTx(client, {
    signer: account,
    market: marketPk,
    direction: b.side === "yes" ? "usdcToYes" : "usdcToNo",
    amount: b.amount,
    slippageBps: ACTIONS_CONFIG.slippageBps,
  });
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: account, blockhash, lastValidBlockHeight });
  tx.add(...built.instructions);
  assertAllowedPrograms(tx);

  const outMint = b.side === "yes" ? client.yesMint(marketPk) : client.noMint(marketPk);
  const sim = await simulateBuy(conn, tx, await getAssociatedTokenAddress(outMint, account));
  if ("error" in sim) return actionError(sim.error);
  const tokens = (sim.received || built.quotedOutput) / 10 ** built.decimals;

  const payload = await createPostResponse({
    fields: {
      type: "transaction",
      transaction: tx,
      message: buyMessage(b.side, tokens, tokens > 0 ? b.amount / tokens : 0),
      links: { next: { type: "inline", action: completedAction(b) } },
    },
  });
  // Re-check the final bytes: createPostResponse may append an identity memo
  // when ACTION_IDENTITY_SECRET is set — we never allow that through.
  if (!("transaction" in payload)) throw new Error("expected a transaction response");
  assertAllowedPrograms(payload.transaction);
  return actionJson(payload);
}

function completedAction(b: BuyRequest): CompletedAction {
  return {
    type: "completed",
    icon: b.iconUrl,
    title: b.market.name,
    label: "You're in. Share your prediction →",
    description: `You bought ${b.side.toUpperCase()}. Share the market: ${b.pageUrl}`,
  };
}
