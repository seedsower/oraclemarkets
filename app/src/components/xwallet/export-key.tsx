"use client";

import { useState } from "react";
import { toast } from "sonner";

const FRESH_SECS = 15 * 60;

/**
 * Show the wallet's private key once, on request (to import into Phantom /
 * Solflare). Needs a sign-in within the last 15 minutes; the server enforces
 * that too, plus a daily limit.
 */
export function ExportKey({ signedInAt }: { signedInAt: number }) {
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fresh = Date.now() / 1000 - signedInAt < FRESH_SECS;

  const reveal = async () => {
    const ok = window.confirm(
      "Show your private key?\n\nAnyone who sees it controls this wallet. Never paste it into a website or share it. The bot keeps access too, so it can still trade for you from X.",
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/xwallet/export", { method: "POST" });
      const body = (await res.json()) as { secretKey?: string; error?: string };
      if (body.error === "reauth") {
        window.location.href = "/api/auth/x/login";
        return;
      }
      if (!res.ok || !body.secretKey) throw new Error(body.error ?? `HTTP ${res.status}`);
      setKey(body.secretKey);
    } catch (e) {
      toast.error("Couldn't export the key", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-line bg-surface/40 p-[16px] flex flex-col gap-[10px]">
      <span className="text-caption">Take your wallet with you</span>
      {key ? (
        <>
          <p className="text-[12px] text-no">
            This is your private key. Anyone who has it controls the wallet. Import it in Phantom
            (Add wallet → Import private key), then close this page.
          </p>
          <code className="font-mono text-[12px] break-all bg-surface-2 rounded-md p-[10px] select-all text-text-hi">
            {key}
          </code>
          <button
            onClick={() => navigator.clipboard.writeText(key).then(() => toast.success("Copied"))}
            className="self-start font-mono text-[12px] text-accent hover:brightness-110 cursor-pointer"
          >
            Copy
          </button>
        </>
      ) : (
        <>
          <p className="text-[13px] text-text-dim">
            Export the private key to use this wallet in Phantom or Solflare.
            {!fresh && " You'll sign in with X again first, for safety."}
          </p>
          <button
            onClick={reveal}
            disabled={busy}
            className="self-start px-[14px] py-[8px] rounded-lg border border-line-2 font-mono text-[12px] text-text hover:border-muted cursor-pointer disabled:opacity-40"
          >
            {busy ? "…" : "Export private key"}
          </button>
        </>
      )}
    </section>
  );
}
