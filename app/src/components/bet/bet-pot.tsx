import { formatUsdc } from "@pm-amm/sdk/math";
import type { BetVaultView } from "@pm-amm/sdk";

/** YES vs NO stakes — the split IS the starting odds. */
export function BetPot({ v }: { v: BetVaultView }) {
  const yesPct = Math.round(v.impliedYes * 100);
  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex items-end justify-between">
        <div className="flex flex-col">
          <span className="font-mono text-[10px] tracking-[0.1em] text-yes">YES</span>
          <span className="text-[28px] leading-none text-yes">{yesPct}%</span>
          <span className="font-mono text-[11px] text-muted mt-[4px]">
            ${formatUsdc(v.yesTotal)} staked
          </span>
        </div>
        <div className="flex flex-col items-center pb-[2px]">
          <span className="font-mono text-[10px] text-muted">POT</span>
          <span className="font-mono text-[15px] text-text-hi">${formatUsdc(v.total)}</span>
          <span className="font-mono text-[10px] text-muted">{v.commitCount} stakes</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="font-mono text-[10px] tracking-[0.1em] text-no">NO</span>
          <span className="text-[28px] leading-none text-no">{100 - yesPct}%</span>
          <span className="font-mono text-[11px] text-muted mt-[4px]">
            ${formatUsdc(v.noTotal)} staked
          </span>
        </div>
      </div>
      <div className="h-[6px] rounded-full bg-no/40 overflow-hidden flex">
        <span className="bg-yes h-full" style={{ width: `${yesPct}%` }} />
      </div>
    </div>
  );
}
