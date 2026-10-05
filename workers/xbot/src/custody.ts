import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  Transaction,
  type Keypair,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { buildSwapTx, CU, SWAP_FEE_BPS, type PmAmmClient } from "@pm-amm/sdk";
import type { Side } from "./money-commands";

/**
 * On-chain side of trading from X (devnet only). User wallets (wallets.ts)
 * sign their own trades; the bot's hot wallet is the fee payer and pays for
 * token accounts, so user wallets only hold USDC and positions. Bet stakes are
 * the one place the program makes the signer pay rent (the BetPosition
 * account), so the bot tops the user up with a little SOL in the same tx.
 */
export interface CustodyConfig {
  master: Buffer;
  starterUsdc: number;
  maxTradeUsdc: number;
  dailyUsdc: number;
  /** Refuse trades whose average price is this much worse than the quote price (+ fee). */
  maxImpactBps: number;
  slippageBps: number;
}

/** A refusal the user should see as-is (not an error to log loudly). */
export class TradeRefused extends Error {}

const DECIMALS = 6;
export const toRaw = (usd: number) => Math.floor(usd * 10 ** DECIMALS);
export const fromRaw = (r: number) => r / 10 ** DECIMALS;
/** Enough SOL for a BetPosition's rent (89 bytes) plus margin. */
const STAKE_SOL_FLOOR = 3_000_000;

/** Average price within the fee + `maxImpactBps` of the quoted price. */
export function priceOk(
  mode: "buy" | "sell",
  avg: number,
  price: number,
  maxImpactBps: number,
): boolean {
  const slack = (SWAP_FEE_BPS + maxImpactBps) / 10_000;
  return mode === "buy" ? avg <= price * (1 + slack) : avg >= price * (1 - slack);
}

export class Custody {
  constructor(
    readonly client: PmAmmClient,
    readonly bot: Keypair,
    readonly cfg: CustodyConfig,
  ) {}

  get mint(): PublicKey {
    return this.client.collateralMint;
  }

  /** Bot pays the fee; signs with the bot and (when it's a signer) the user. */
  async send(ixs: TransactionInstruction[], user: Keypair | null): Promise<string> {
    const conn = this.client.connection;
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: this.bot.publicKey, blockhash, lastValidBlockHeight });
    tx.add(...ixs);
    tx.sign(...(user ? [this.bot, user] : [this.bot]));
    const sig = await conn.sendRawTransaction(tx.serialize());
    const res = await conn.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      "confirmed",
    );
    if (res.value.err) throw new Error(`transaction failed: ${JSON.stringify(res.value.err)}`);
    return sig;
  }

  /** Raw token balance of `owner`'s ATA for `mint` (0 if it doesn't exist). */
  async tokenBalance(owner: PublicKey, mint: PublicKey): Promise<number> {
    const ata = getAssociatedTokenAddressSync(mint, owner, true);
    const b = await this.client.connection.getTokenAccountBalance(ata).catch(() => null);
    return b ? Number(b.value.amount) : 0;
  }

  usdc = async (owner: PublicKey) => fromRaw(await this.tokenBalance(owner, this.mint));

  /** ATA for `owner`, created by the bot if missing (idempotent). */
  private ataIx(owner: PublicKey, mint: PublicKey): TransactionInstruction {
    const ata = getAssociatedTokenAddressSync(mint, owner, true);
    return createAssociatedTokenAccountIdempotentInstruction(this.bot.publicKey, ata, owner, mint);
  }

  private transferIx(from: PublicKey, to: PublicKey, amount: number): TransactionInstruction {
    const src = getAssociatedTokenAddressSync(this.mint, from, true);
    const dst = getAssociatedTokenAddressSync(this.mint, to, true);
    return createTransferCheckedInstruction(src, this.mint, dst, from, amount, DECIMALS);
  }

  /** Starter balance for a new wallet, from the bot's own USDC float. */
  async fund(user: PublicKey): Promise<string> {
    const amount = toRaw(this.cfg.starterUsdc);
    if ((await this.tokenBalance(this.bot.publicKey, this.mint)) < amount) {
      throw new TradeRefused("The starter-funds float is empty right now. Try again later.");
    }
    const ixs = [this.ataIx(user, this.mint), this.transferIx(this.bot.publicKey, user, amount)];
    return this.send(ixs, null);
  }

  /** Buy (USDC → YES/NO) or sell (YES/NO → USDC; `amount` in tokens) on a binary market. */
  async swap(user: Keypair, market: PublicKey, side: Side, mode: "buy" | "sell", amount: number) {
    const yes = side === "yes";
    const direction =
      mode === "buy" ? (yes ? "usdcToYes" : "usdcToNo") : yes ? "yesToUsdc" : "noToUsdc";
    const built = await buildSwapTx(this.client, {
      signer: user.publicKey,
      payer: this.bot.publicKey,
      market,
      direction,
      amount,
      slippageBps: this.cfg.slippageBps,
    });
    const price = yes ? built.priceBefore : 1 - built.priceBefore;
    const avg =
      mode === "buy" ? built.amountIn / built.quotedOutput : built.quotedOutput / built.amountIn;
    if (!priceOk(mode, avg, price, this.cfg.maxImpactBps)) {
      throw new TradeRefused("That trade would move the price too much. Try a smaller amount.");
    }
    const sig = await this.send(built.instructions, user);
    return { sig, avg, amountIn: fromRaw(built.amountIn), out: fromRaw(built.quotedOutput), price };
  }

  async stake(user: Keypair, betVault: PublicKey, side: Side, usd: number): Promise<string> {
    const ixs: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: CU.DEFAULT }),
    ];
    const lamports = await this.client.connection.getBalance(user.publicKey);
    if (lamports < STAKE_SOL_FLOOR) {
      ixs.push(
        SystemProgram.transfer({
          fromPubkey: this.bot.publicKey,
          toPubkey: user.publicKey,
          lamports: STAKE_SOL_FLOOR - lamports,
        }),
      );
    }
    ixs.push(this.ataIx(user.publicKey, this.mint));
    ixs.push(
      await this.client.ix.betCommit({
        signer: user.publicKey,
        betVault,
        side,
        amount: toRaw(usd),
        collateralMint: this.mint,
      }),
    );
    return this.send(ixs, user);
  }

  async withdraw(user: Keypair, to: PublicKey, usd: number): Promise<string> {
    const ixs = [this.ataIx(to, this.mint), this.transferIx(user.publicKey, to, toRaw(usd))];
    return this.send(ixs, user);
  }

  /** Redeem a resolved market's winning tokens to USDC. */
  async claimMarket(user: Keypair, market: PublicKey): Promise<string> {
    const ixs = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: CU.HEAVY }),
      this.ataIx(user.publicKey, this.client.yesMint(market)),
      this.ataIx(user.publicKey, this.client.noMint(market)),
      this.ataIx(user.publicKey, this.mint),
      await this.client.ix.claimWinnings({
        signer: user.publicKey,
        market,
        collateralMint: this.mint,
      }),
    ];
    return this.send(ixs, user);
  }

  /** A settled/voided bet's payout (claim) or a bet that never launched (refund). */
  async collectBet(user: Keypair, betVault: PublicKey, how: "claim" | "refund"): Promise<string> {
    const p = { signer: user.publicKey, betVault, collateralMint: this.mint };
    const ix =
      how === "claim" ? await this.client.ix.claimBet(p) : await this.client.ix.refundBet(p);
    const budget = ComputeBudgetProgram.setComputeUnitLimit({ units: CU.DEFAULT });
    return this.send([budget, this.ataIx(user.publicKey, this.mint), ix], user);
  }
}
