import { PublicKey } from "@solana/web3.js";
import { MetaRow } from "@/components/ui/meta-row";
import { solscanAccountUrl } from "@/lib/constants";
import type { MarketData } from "@/hooks/use-markets";

const URL_RE = /https?:\/\/[^\s]+/i;

function hostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function short(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function AddressLink({ address }: { address: string }) {
  return (
    <a
      href={solscanAccountUrl(address)}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:text-text-hi underline underline-offset-2"
    >
      {short(address)} ↗
    </a>
  );
}

/** Off-curve authority = a program PDA (e.g. a Bet Vault), not a person's wallet. */
function isProgramOwned(address: string): boolean {
  try {
    return !PublicKey.isOnCurve(new PublicKey(address).toBytes());
  } catch {
    return false;
  }
}

/**
 * Who decides the outcome. Resolution is admin-signed by the market authority
 * (or the group / vault that owns it) — there is no on-chain oracle, and the
 * copy must never imply one.
 */
export function ResolverInfo({
  market,
  resolutionSource,
}: {
  market: MarketData;
  resolutionSource?: string;
}) {
  const source = resolutionSource ?? market.name.match(URL_RE)?.[0];
  const sourceHost = source ? hostname(source) : null;
  const note = market.group
    ? "Group authority resolves every leg at once"
    : isProgramOwned(market.authority)
      ? "Vault-controlled market — the vault's resolver signs the outcome"
      : "The market authority signs the outcome (no on-chain oracle)";

  return (
    <div className="max-w-md">
      <MetaRow
        label={market.group ? "Resolved via group" : "Resolved by"}
        value={<AddressLink address={market.group || market.authority} />}
      />
      {source && sourceHost && (
        <MetaRow
          label="Resolution source"
          value={
            <a
              href={source}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="hover:text-text-hi underline underline-offset-2 break-all"
            >
              {sourceHost} ↗
            </a>
          }
        />
      )}
      <p className="py-[7px] text-[11px] text-muted font-mono">{note}</p>
    </div>
  );
}
