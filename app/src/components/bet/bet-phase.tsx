"use client";

import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import type { BetPhase, BetVaultView } from "@pm-amm/sdk";
import { formatUsdc } from "@pm-amm/sdk/math";
import { Button } from "@/components/ui/button";
import { Countdown } from "@/components/ui/countdown";
import { useClient } from "@/lib/pm-amm-client";
import { previewClaim, type MyBet } from "@/lib/bets";
import { useBetTx } from "./use-bet-tx";

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] leading-[1.6] text-text-dim">{children}</p>;
}

/** Resolver-only: decide the outcome, then settle so winners can claim. */
export function ResolveButtons({ v }: { v: BetVaultView }) {
  const client = useClient();
  const { run, busy } = useBetTx();
  const resolve = (side: "yes" | "no") =>
    client &&
    run(`Resolved ${side.toUpperCase()}`, async () => {
      const pk = new PublicKey(v.publicKey);
      const sig = await client.send.resolveBetVault(pk, side);
      // Settling is permissionless; do it now so claims open immediately.
      await client.send.settleBetVault(pk).catch(() => undefined);
      return sig;
    });
  return (
    <div className="grid grid-cols-2 gap-[8px]">
      <Button variant="yes" disabled={!!busy} onClick={() => resolve("yes")}>
        YES won
      </Button>
      <Button variant="no" disabled={!!busy} onClick={() => resolve("no")}>
        NO won
      </Button>
    </div>
  );
}

function ClaimBox({ v, me }: { v: BetVaultView; me: MyBet | null | undefined }) {
  const client = useClient();
  const { run, busy } = useBetTx();
  if (!me) return <Note>Connect the wallet you staked with to see your result.</Note>;
  const c = previewClaim(v, me);
  if (c.outcome === "lost") return <Note>Your side lost this one.</Note>;
  const label = c.outcome === "refund" ? "Claim refund" : "Claim winnings";
  return (
    <Button
      variant="yes"
      className="w-full"
      disabled={!!busy || c.payout <= 0}
      onClick={() => client && run(label, () => client.send.claimBet(new PublicKey(v.publicKey)))}
    >
      {busy ? "Claiming…" : `${label}: $${formatUsdc(c.payout)}`}
    </Button>
  );
}

interface PhaseProps {
  v: BetVaultView;
  me: MyBet | null | undefined;
  marketId: number | null;
}

/** One wallet action button for a phase (refund / settle / void). */
function ActionButton(props: {
  label: string;
  done: string;
  send: (pk: PublicKey) => Promise<string>;
  v: BetVaultView;
}) {
  const client = useClient();
  const { run, busy } = useBetTx();
  const pk = new PublicKey(props.v.publicKey);
  return (
    <Button
      className="w-full"
      disabled={!!busy || !client}
      onClick={() => client && run(props.done, () => props.send(pk))}
    >
      {busy ? "Working…" : props.label}
    </Button>
  );
}

function Refundable({ v, me }: PhaseProps) {
  const client = useClient();
  return (
    <div className="flex flex-col gap-[10px]">
      <Note>
        This bet didn&apos;t fill: it needs stakes on both sides and at least $
        {formatUsdc(v.minTotal)} in total. Every stake is refunded 1:1.
      </Note>
      {me && client && (
        <ActionButton
          v={v}
          label={`Refund $${formatUsdc(me.yes + me.no)}`}
          done="Refunded"
          send={(pk) => client.send.refundBet(pk)}
        />
      )}
    </div>
  );
}

function Live({ v, marketId }: PhaseProps) {
  return (
    <div className="flex flex-col gap-[10px]">
      <Note>
        The market is live. It opened at YES {(v.priceBps / 100).toFixed(0)}% and ends in{" "}
        <Countdown endTs={v.marketEndTs} />. Anyone can trade it until then.
      </Note>
      {marketId !== null && (
        <Link
          href={`/market/${marketId}`}
          className="text-center px-[14px] py-[10px] bg-text-hi text-bg rounded-md font-mono text-[12px] font-medium"
        >
          Trade the market →
        </Link>
      )}
    </div>
  );
}

function Awaiting({ v }: PhaseProps) {
  const { publicKey } = useWallet();
  return (
    <div className="flex flex-col gap-[10px]">
      <Note>The market has ended. Waiting for the result from {short(v.resolver)}.</Note>
      {publicKey?.toBase58() === v.resolver && <ResolveButtons v={v} />}
    </div>
  );
}

function SettleReady({ v }: PhaseProps) {
  const client = useClient();
  return (
    <div className="flex flex-col gap-[10px]">
      <Note>The result is in. Settle the bet to unlock claims (anyone can do this).</Note>
      {client && (
        <ActionButton
          v={v}
          label="Settle bet"
          done="Settled"
          send={(pk) => client.send.settleBetVault(pk)}
        />
      )}
    </div>
  );
}

function Voidable({ v }: PhaseProps) {
  const client = useClient();
  return (
    <div className="flex flex-col gap-[10px]">
      <Note>Not resolved in time. Anyone can void the bet so everyone gets their stake back.</Note>
      {client && (
        <ActionButton
          v={v}
          label="Void & refund everyone"
          done="Voided"
          send={(pk) => client.send.voidBetVault(pk)}
        />
      )}
    </div>
  );
}

function Claimable(props: PhaseProps) {
  const { v } = props;
  return (
    <div className="flex flex-col gap-[10px]">
      <Note>
        {v.voided
          ? "This bet was voided. Every stake is refunded pro-rata."
          : `${v.winningSide === 1 ? "YES" : "NO"} won. Winners split $${formatUsdc(v.payoutPool)}.`}
      </Note>
      <ClaimBox v={v} me={props.me} />
    </div>
  );
}

/** What the bet page shows and allows in each phase of the bet's life. */
export function BetPhasePanel(props: PhaseProps & { phase: BetPhase }) {
  switch (props.phase) {
    case "staking":
      return (
        <Note>
          Stakes close in <Countdown endTs={props.v.commitEndTs} />. The split of the pot sets the
          starting odds.
        </Note>
      );
    case "launch-ready":
      return <Note>Betting closed. The market launches shortly at the stake-implied odds.</Note>;
    case "refundable":
      return <Refundable {...props} />;
    case "live":
      return <Live {...props} />;
    case "awaiting-resolution":
      return <Awaiting {...props} />;
    case "settle-ready":
      return <SettleReady {...props} />;
    case "voidable":
      return <Voidable {...props} />;
    case "claimable":
    case "voided":
      return <Claimable {...props} />;
  }
}
