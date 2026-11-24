"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { curatorRunMessage, type CuratorRunState } from "@/lib/curator-run";

const KEY = ["curator-run"];
const at = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

/** Sign + POST a run request (admin wallets only; checked by the server). */
function useRequestRun() {
  const { publicKey, signMessage } = useWallet();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!publicKey || !signMessage) return toast.error("Connect a wallet that can sign messages");
    setBusy(true);
    try {
      const ts = Math.floor(Date.now() / 1000);
      const sig = await signMessage(new TextEncoder().encode(curatorRunMessage(ts)));
      const res = await fetch("/api/admin/curator/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signer: publicKey.toBase58(),
          ts,
          signature: Buffer.from(sig).toString("base64"),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast.success("Curator run queued", { description: "It starts within a minute." });
      await qc.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      const msg = errorMessage(e);
      toast.error("Not queued", { description: /reject/i.test(msg) ? "Cancelled in wallet" : msg });
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}

/**
 * Admin: run the curator now (otherwise it runs every 3 days at 14:00 UTC).
 * Whether it creates markets depends on the service's CURATOR_DRY_RUN.
 */
export function CuratorRun() {
  const { data } = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<CuratorRunState> =>
      (await fetch("/api/admin/curator/run")).json() as Promise<CuratorRunState>,
    refetchInterval: 15_000,
  });
  const { run, busy } = useRequestRun();
  const last = data?.last;
  return (
    <div className="space-y-[8px]">
      <Button onClick={run} disabled={busy || !!data?.pending}>
        {data?.pending ? "Run queued…" : busy ? "Signing…" : "Run curator now"}
      </Button>
      {last && (
        <p className={`text-[11px] font-mono ${last.error ? "text-no" : "text-muted"}`}>
          Last request {at(last.requestedAt)}
          {last.triggeredAt ? ` → started ${at(last.triggeredAt)}` : ""}
          {last.error ? ` → failed: ${last.error}` : ""}
        </p>
      )}
    </div>
  );
}
