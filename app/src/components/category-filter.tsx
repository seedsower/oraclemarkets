"use client";

import { useCallback, useEffect, useState } from "react";
import { CATEGORIES, isCategory, type CategorySlug } from "@/lib/categories";

export type CategoryFilterValue = CategorySlug | "all";

/** Selected category, synced to `?category=` so filtered views can be shared. */
export function useCategoryFilter(): [CategoryFilterValue, (v: CategoryFilterValue) => void] {
  const [value, setValue] = useState<CategoryFilterValue>("all");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("category");
    if (isCategory(q)) setValue(q);
  }, []);
  const set = useCallback((v: CategoryFilterValue) => {
    setValue(v);
    const url = new URL(window.location.href);
    if (v === "all") url.searchParams.delete("category");
    else url.searchParams.set("category", v);
    window.history.replaceState(null, "", url);
  }, []);
  return [value, set];
}

export function CategoryFilter({
  value,
  onChange,
}: {
  value: CategoryFilterValue;
  onChange: (v: CategoryFilterValue) => void;
}) {
  const options: { slug: CategoryFilterValue; label: string }[] = [
    { slug: "all", label: "All" },
    ...CATEGORIES,
  ];
  return (
    <nav
      aria-label="Categories"
      className="flex gap-[6px] overflow-x-auto whitespace-nowrap px-[16px] md:px-[24px] py-[10px] border-b border-line"
    >
      {options.map((o) => (
        <button
          key={o.slug}
          onClick={() => onChange(o.slug)}
          aria-pressed={value === o.slug}
          className={[
            "px-[12px] py-[5px] rounded-full font-sans text-[13px] cursor-pointer transition-all duration-[120ms]",
            value === o.slug
              ? "bg-text-hi text-bg"
              : "text-text-dim hover:text-text-hi hover:bg-surface",
          ].join(" ")}
        >
          {o.label}
        </button>
      ))}
    </nav>
  );
}
