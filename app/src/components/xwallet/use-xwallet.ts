"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { deriveNoMint, deriveYesMint } from "@pm-amm/sdk";
import { PROGRAM_ID, USDC_MINT } from "@/lib/constants";
import { useMarkets, type MarketData } from "@/hooks/use-markets";

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
