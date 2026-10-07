"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  betPhase,
  deriveNoMint,
  deriveYesMint,
  type BetPositionAccount,
  type BetVaultView,
} from "@pm-amm/sdk";
import { PROGRAM_ID, USDC_MINT } from "@/lib/constants";
import { useMarkets, type MarketData } from "@/hooks/use-markets";
import { useBetVaults } from "@/hooks/use-bet-vaults";
import { getClient } from "@/lib/pm-amm-client";
import { previewClaim } from "@/lib/bets";

export interface XWalletSession {
  signedIn: boolean;
  handle?: string;
  wallet?: string | null;
  signedInAt?: number;
}

export function useXSession() {
  return useQuery({
    queryKey: ["xwallet"],
    queryFn: async (): Promise<XWalletSession> => (await fetch("/api/xwallet")).json(),
    staleTime: 30_000,
  });
}

export interface Holding {
  market: MarketData;
  side: "YES" | "NO";
  amount: number;
  value: number;
}

/** USDC + YES/NO holdings of the X wallet (token accounts mapped to markets). */
export function useXHoldings(wallet: string | null | undefined) {
  const { connection } = useConnection();
  const { data: markets } = useMarkets();
  return useQuery({
    queryKey: ["xwallet-holdings", wallet, markets?.length ?? 0],
    enabled: !!wallet,
    refetchInterval: 30_000,
    queryFn: async () => {
      const owner = new PublicKey(wallet!);
      const usdcAta = getAssociatedTokenAddressSync(USDC_MINT, owner);
      const usdc = await connection.getTokenAccountBalance(usdcAta).catch(() => null);
      const accounts = await connection.getParsedTokenAccountsByOwner(owner, {
        programId: TOKEN_PROGRAM_ID,
      });
      const amounts = new Map<string, number>();
      for (const a of accounts.value) {
        const info = a.account.data.parsed.info as {
          mint: string;
          tokenAmount: { uiAmount: number };
        };
        if (info.tokenAmount.uiAmount > 0) amounts.set(info.mint, info.tokenAmount.uiAmount);
      }
      const holdings: Holding[] = [];
      for (const m of markets ?? []) {
        const pk = new PublicKey(m.publicKey);
        const yes = amounts.get(deriveYesMint(PROGRAM_ID, pk).toBase58());
        const no = amounts.get(deriveNoMint(PROGRAM_ID, pk).toBase58());
        if (yes) holdings.push({ market: m, side: "YES", amount: yes, value: yes * m.price });
        if (no) holdings.push({ market: m, side: "NO", amount: no, value: no * (1 - m.price) });
      }
      holdings.sort((a, b) => b.value - a.value);
      return { usdc: usdc?.value.uiAmount ?? 0, holdings };
    },
  });
}

export interface Stake {
  bet: BetVaultView;
  yes: number;
  no: number;
  /** What the stake is doing now, for the label. */
  status: string;
  tone: "yes" | "no" | "muted" | "accent";
}

const usd = (raw: number) => `$${(raw / 1e6).toFixed(2).replace(/\.00$/, "")}`;

/** Label for a stake from the bet's phase (and, once settled, the payout preview). */
export function stakeStatus(
  v: BetVaultView,
  yes: number,
  no: number,
  now: number,
  marketResolved: boolean,
) {
  const phase = betPhase(v, now, marketResolved);
  if (phase === "staking") return { status: "Taking stakes", tone: "accent" as const };
  if (phase === "launch-ready" || phase === "live")
    return { status: "Live", tone: "accent" as const };
  if (phase === "refundable")
    return { status: `Refund ${usd(yes + no)} on its way`, tone: "muted" as const };
  if (phase === "claimable" || phase === "voided") {
    const c = previewClaim(v, { yes, no });
    if (c.outcome === "lost") return { status: "Lost", tone: "no" as const };
    const what = c.outcome === "refund" ? "Refund" : "Won";
    return { status: `${what} ${usd(c.payout)}, paying out`, tone: "yes" as const };
  }
  return { status: "Waiting for the result", tone: "muted" as const };
}

/** The X wallet's open bet stakes (claimed / refunded ones are closed on-chain, so they drop off). */
export function useXStakes(wallet: string | null | undefined) {
  const { connection } = useConnection();
  const { data: bets } = useBetVaults();
  const { data: markets } = useMarkets();
  return useQuery({
    queryKey: ["xwallet-stakes", wallet, bets?.length ?? 0],
    enabled: !!wallet && !!bets,
    refetchInterval: 30_000,
    queryFn: async (): Promise<Stake[]> => {
      const client = getClient(connection);
      const owner = new PublicKey(wallet!);
      const list = bets ?? [];
      const pdas = list.map((v) => client.betPosition(new PublicKey(v.publicKey), owner));
      const infos: (AccountInfo<Buffer> | null)[] = [];
      for (let i = 0; i < pdas.length; i += 100) {
        infos.push(...(await connection.getMultipleAccountsInfo(pdas.slice(i, i + 100))));
      }
      const resolved = new Set((markets ?? []).filter((m) => m.resolved).map((m) => m.publicKey));
      const now = Math.floor(Date.now() / 1000);
      const out: Stake[] = [];
      infos.forEach((info, i) => {
        if (!info) return;
        const pos = client.program.coder.accounts.decode<BetPositionAccount>(
          "betPosition",
          info.data,
        );
        const yes = Number(pos.yesAmount.toString());
        const no = Number(pos.noAmount.toString());
        if (yes + no <= 0) return;
        const bet = list[i]!;
        out.push({ bet, yes, no, ...stakeStatus(bet, yes, no, now, resolved.has(bet.market)) });
      });
      return out.sort((a, b) => b.bet.marketEndTs - a.bet.marketEndTs);
    },
  });
}
