import type { Curation } from "@/lib/featured";

/** "Featured | All markets" switch — rendered only when a featured list is configured. */
export function CurationToggle({ curation }: { curation: Curation }) {
  if (!curation.enabled) return null;
  const options = [
    { all: false, label: "Featured" },
    { all: true, label: "All markets" },
  ];
  return (
    <div className="flex gap-[2px] border border-line rounded-sm" role="group">
      {options.map((o) => (
        <button
          key={o.label}
          onClick={() => curation.setShowAll(o.all)}
          aria-pressed={curation.showAll === o.all}
          className={[
            "px-[8px] py-[3px] text-[10px] uppercase cursor-pointer transition-all duration-[120ms]",
            curation.showAll === o.all
              ? "text-text-hi bg-surface"
              : "text-muted hover:text-text-hi",
          ].join(" ")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
