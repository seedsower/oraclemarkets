"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import type { BetVaultView } from "@pm-amm/sdk";
import { Button } from "@/components/ui/button";
import { OpenInWallet } from "@/components/open-in-wallet";
import { IS_MAINNET, USDC_MINT } from "@/lib/constants";
import { useFaucet } from "@/lib/faucet";
import { useClient } from "@/lib/pm-amm-client";
import { DEFAULT_STAKE_USDC } from "@/lib/bets";
import type { BuySide } from "@/lib/share";
import { useBetTx } from "./use-bet-tx";

/** Wallet's balance of the bet's collateral, in human units. */
function useCollateralBalance(mint: string) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  return useQuery({
    queryKey: ["user-tokens", "bet-collateral", publicKey?.toBase58(), mint],
    enabled: !!publicKey,
    queryFn: async () => {
      const ata = await getAssociatedTokenAddress(new PublicKey(mint), publicKey!);
      try {
        return (await connection.getTokenAccountBalance(ata)).value.uiAmount ?? 0;
      } catch {
        return 0;
      }
    },
    refetchInterval: 15_000,
  });
}

function SideToggle({ side, onChange }: { side: BuySide; onChange: (s: BuySide) => void }) {
  return (
    <div className="grid grid-cols-2 gap-[8px]">
      {(["yes", "no"] as const).map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={[
            "py-[10px] rounded-md font-mono text-[13px] border cursor-pointer transition-all duration-[120ms]",
            side === s
              ? s === "yes"
                ? "bg-yes text-bg border-yes"
                : "bg-no text-bg border-no"
              : "border-line-2 text-text-dim hover:text-text-hi",
          ].join(" ")}
        >
          {s.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function AmountField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-[8px] border border-line-2 rounded-md px-[12px] py-[8px]">
      <span className="font-mono text-[12px] text-muted">$</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
        className="flex-1 bg-transparent outline-none font-mono text-[15px] text-text-hi"
        aria-label="Stake amount in USDC"
      />
      <span className="font-mono text-[11px] text-muted">USDC · min $1</span>
    </label>
  );
}

/** Devnet only: top up mock USDC without leaving the bet. */
function FaucetPrompt() {
  const { publicKey } = useWallet();
  const faucet = useFaucet();
  return (
    <div className="flex items-center justify-between gap-[10px] text-[12px] text-text-dim">
      <span>Not enough test USDC.</span>
      <button
        onClick={() => publicKey && faucet.request(publicKey.toBase58())}
        disabled={faucet.busy}
        className="px-[10px] py-[5px] bg-yes text-bg rounded-sm font-mono text-[11px] cursor-pointer disabled:opacity-50"
      >
        {faucet.busy ? "Sending…" : "Get 1,000 free"}
      </button>
    </div>
  );
}

export function BetStakePanel({
  v,
  intent,
}: {
  v: BetVaultView;
  intent: { side: BuySide; amount: number } | null;
}) {
  const [side, setSide] = useState<BuySide>("yes");
  const [amount, setAmount] = useState(String(DEFAULT_STAKE_USDC));
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const client = useClient();
  const { run, busy } = useBetTx();
  const { data: balance } = useCollateralBalance(v.collateralMint);

  useEffect(() => {
    if (!intent) return;
    setSide(intent.side);
    setAmount(String(intent.amount));
  }, [intent]);

  const n = Number(amount);
  const valid = Number.isFinite(n) && n >= 1;
  const short =
    !IS_MAINNET && connected && v.collateralMint === USDC_MINT.toBase58() && (balance ?? 0) < n;

  const stake = () => {
    if (!connected) return setVisible(true);
    if (!client || !valid) return;
    void run(`Staked $${n} on ${side.toUpperCase()}`, () =>
      client.send.betCommit(new PublicKey(v.publicKey), side, n),
    );
  };

  return (
    <div className="border border-line rounded-lg p-[16px] flex flex-col gap-[12px]">
      <OpenInWallet />
      <SideToggle side={side} onChange={setSide} />
      <AmountField value={amount} onChange={setAmount} />
      {short && <FaucetPrompt />}
      <Button
        variant={side === "yes" ? "yes" : "no"}
        className="w-full uppercase text-[12px] tracking-[0.05em]"
        onClick={stake}
        disabled={!!busy || (connected && (!valid || short))}
      >
        {busy
          ? "Staking…"
          : connected
            ? `Stake $${valid ? n : 0} on ${side.toUpperCase()}`
            : "Connect wallet"}
      </Button>
      <p className="text-[11px] leading-[1.5] text-muted">
        Winners split the whole pot, losers get nothing. If it doesn&apos;t fill, or is never
        resolved, every stake is refunded.
      </p>
    </div>
  );
}
