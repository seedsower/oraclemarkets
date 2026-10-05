"use client";

import { useEffect, useState } from "react";
import { needsWalletApp, walletBrowseLinks } from "@/lib/wallet-links";

/**
 * On phones without a wallet in the browser (typical when tapping a link in
 * the X app), offer to reopen this exact page — buy intent included — inside
 * Phantom or Solflare, where the wallet is connected.
 */
export function OpenInWallet() {
  const [links, setLinks] = useState<ReturnType<typeof walletBrowseLinks> | null>(null);

  useEffect(() => {
    if (needsWalletApp()) setLinks(walletBrowseLinks(window.location.href, window.location.origin));
  }, []);

  if (!links) return null;
  const btn =
    "flex-1 text-center px-[12px] py-[10px] rounded-md font-mono text-[12px] font-medium tracking-[0.03em]";
  return (
    <div className="border border-line-2 bg-surface rounded-lg p-[14px] flex flex-col gap-[10px]">
      <div className="text-[13px] text-text-hi">Trade from your phone</div>
      <p className="text-[12px] leading-[1.5] text-text-dim">
        Open this market in your wallet app to connect and confirm in one step.
      </p>
      <div className="flex gap-[8px]">
        <a href={links.phantom} className={`${btn} bg-accent text-bg`}>
          Open in Phantom
        </a>
        <a href={links.solflare} className={`${btn} border border-line-2 text-text-hi`}>
          Open in Solflare
        </a>
      </div>
    </div>
  );
}
