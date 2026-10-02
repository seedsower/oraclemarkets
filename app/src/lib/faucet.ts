"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * Devnet test-USDC faucet. NEXT_PUBLIC_FAUCET_URL points at any compatible
 * faucet (POST {wallet} → {ok, amount, sol} | {error}); default is our own
 * /api/faucet, which needs MINT_AUTHORITY_KEY on the server.
 *
 * It's called from the BROWSER on purpose: faucets rate-limit per IP, and a
 * server-side proxy would put every visitor behind Railway's one IP.
 */
export const FAUCET_URL = process.env.NEXT_PUBLIC_FAUCET_URL || "/api/faucet";

interface FaucetResult {
  ok?: boolean;
  amount?: number;
  sol?: number;
  error?: string;
}

export function useFaucet() {
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  const request = async (wallet: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(FAUCET_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet }),
      });
      const data = (await res.json().catch(() => ({}))) as FaucetResult;
      if (data.ok) {
        const sol = data.sol ? ` + ${data.sol} SOL` : "";
        toast.success(`+${data.amount ?? 1000} test USDC${sol}`, {
          description: "Devnet funds sent to your wallet — no real value.",
        });
        // Balances update on the next poll; nudge them now.
        setTimeout(() => queryClient.invalidateQueries({ queryKey: ["user-tokens"] }), 2500);
      } else {
        toast.error("Faucet unavailable", { description: data.error ?? `HTTP ${res.status}` });
      }
    } catch {
      toast.error("Faucet unavailable");
    } finally {
      setBusy(false);
    }
  };

  return { request, busy };
}
