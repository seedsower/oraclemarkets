"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { solscanTxUrl } from "@/lib/constants";

/** Short reason from a failed transaction (Anchor error name or message). */
function reason(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const anchor = msg.match(/Error Message: ([^.]+)/)?.[1];
  if (anchor) return anchor;
  if (/User rejected/i.test(msg)) return "Cancelled in wallet";
  return msg.slice(0, 140);
}

/** Runs one wallet-signed bet transaction with toasts and a data refresh. */
export function useBetTx() {
  const [busy, setBusy] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const run = async (label: string, send: () => Promise<string | { signature: string }>) => {
    if (busy) return;
    setBusy(label);
    try {
      const out = await send();
      const sig = typeof out === "string" ? out : out.signature;
      toast.success(label, {
        action: { label: "Solscan ↗", onClick: () => window.open(solscanTxUrl(sig), "_blank") },
      });
      // Explicit invalidation → the lists bypass the keeper cache (see cached-list).
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["bet_vaults"] }),
        queryClient.invalidateQueries({ queryKey: ["bet-position"] }),
        queryClient.invalidateQueries({ queryKey: ["user-tokens"] }),
      ]);
    } catch (e) {
      toast.error(`${label} failed`, { description: reason(e) });
    } finally {
      setBusy(null);
    }
  };

  return { run, busy };
}
