"use client";

import { useState } from "react";

/**
 * A market's illustration (/api/art/<account>, drawn by Claude via the X bot).
 * Renders nothing until art exists — new markets get theirs within minutes.
 */
export function MarketArt({ account, className = "" }: { account: string; className?: string }) {
  const [missing, setMissing] = useState(false);
  if (missing || !account) return null;
  return (
    <img
      src={`/api/art/${account}`}
      alt=""
      loading="lazy"
      onError={() => setMissing(true)}
      className={`block object-cover bg-surface ${className}`}
    />
  );
}
