"use client";

import { useCallback, useEffect, useState } from "react";

export type FeedView = "cards" | "list";
const KEY = "oracle:marketsView";

/** Cards (default) or list, remembered per visitor (best-effort storage). */
export function useFeedView(): [FeedView, (v: FeedView) => void] {
  const [view, setViewState] = useState<FeedView>("cards");
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === "list") setViewState("list");
    } catch {
      // storage blocked → default
    }
  }, []);
  const setView = useCallback((v: FeedView) => {
    setViewState(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // non-persistent is fine
    }
  }, []);
  return [view, setView];
}

export function ViewToggle({
  view,
  onChange,
}: {
  view: FeedView;
  onChange: (v: FeedView) => void;
}) {
  return (
    <div className="flex gap-[2px] border border-line rounded-sm" role="group" aria-label="Layout">
      {(["cards", "list"] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          aria-pressed={view === v}
          className={[
            "px-[8px] py-[3px] text-[10px] uppercase cursor-pointer transition-all duration-[120ms]",
            view === v ? "text-text-hi bg-surface" : "text-muted hover:text-text-hi",
          ].join(" ")}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
