"use client";

import { CATEGORIES, categoryLabel, type CategorySlug } from "@/lib/categories";

/** Chip row to pick one category (required on create forms). */
export function CategoryPicker({
  value,
  onChange,
}: {
  value: CategorySlug | null;
  onChange: (v: CategorySlug) => void;
}) {
  return (
    <div className="flex flex-wrap gap-[6px]" role="radiogroup" aria-label="Category">
      {CATEGORIES.map((c) => (
        <button
          key={c.slug}
          type="button"
          role="radio"
          aria-checked={value === c.slug}
          onClick={() => onChange(c.slug)}
          className={[
            "px-[10px] py-[5px] rounded-full border font-mono text-[11px] tracking-[0.03em] cursor-pointer transition-all duration-[120ms]",
            value === c.slug
              ? "bg-text-hi text-bg border-text-hi"
              : "border-line-2 text-text-dim hover:text-text-hi hover:border-muted",
          ].join(" ")}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

/** Small read-only label (cards, headers). */
export function CategoryChip({ slug }: { slug: string | null | undefined }) {
  const label = categoryLabel(slug);
  if (!label) return null;
  return (
    <span className="px-[6px] py-[1px] rounded-sm border border-line-2 text-text-dim font-mono text-[9px] uppercase tracking-[0.06em]">
      {label}
    </span>
  );
}
